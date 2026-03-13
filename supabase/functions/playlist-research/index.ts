import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { track_name } = await req.json();
    if (!track_name) return json({ error: "track_name required" }, 400);

    const spotifyClientId = Deno.env.get("SPOTIFY_CLIENT_ID");
    const spotifyClientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET");
    const soundcloudClientId = Deno.env.get("SOUNDCLOUD_CLIENT_ID");

    if (!spotifyClientId || !spotifyClientSecret) {
      return json({ error: "Spotify credentials not configured" }, 500);
    }

    // Step 1: Get Spotify access token
    const tokenResp = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${spotifyClientId}:${spotifyClientSecret}`)}`,
      },
      body: "grant_type=client_credentials",
    });
    const { access_token } = await tokenResp.json();
    const spot = (url: string) =>
      fetch(url, { headers: { Authorization: `Bearer ${access_token}` } }).then((r) => r.json());

    // Step 2: Find track on Spotify
    const searchData = await spot(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(track_name)}&type=track&limit=1`
    );
    const track = searchData?.tracks?.items?.[0];
    if (!track) return json({ error: `Track "${track_name}" not found on Spotify` }, 404);

    const trackId = track.id;
    const artistId = track.artists[0].id;

    // Step 3: Get audio features + related artists in parallel
    const [featuresData, relatedData] = await Promise.all([
      spot(`https://api.spotify.com/v1/audio-features/${trackId}`),
      spot(`https://api.spotify.com/v1/artists/${artistId}/related-artists`),
    ]);

    const features = featuresData;
    const relatedArtists = (relatedData?.artists || []).slice(0, 5);
    const relatedIds = relatedArtists.map((a: any) => a.id);

    // Step 4: Get recommendations seeded by track + related artists
    const recsUrl = new URL("https://api.spotify.com/v1/recommendations");
    recsUrl.searchParams.set("seed_tracks", trackId);
    if (relatedIds[0]) recsUrl.searchParams.set("seed_artists", relatedIds[0]);
    recsUrl.searchParams.set("limit", "100");
    if (features?.tempo) {
      recsUrl.searchParams.set("target_tempo", String(Math.round(features.tempo)));
      recsUrl.searchParams.set("min_tempo", String(Math.round(features.tempo * 0.88)));
      recsUrl.searchParams.set("max_tempo", String(Math.round(features.tempo * 1.12)));
    }
    if (features?.energy !== undefined) {
      recsUrl.searchParams.set("target_energy", String(features.energy));
      recsUrl.searchParams.set("min_energy", String(Math.max(0, features.energy - 0.2)));
    }
    if (features?.danceability !== undefined) {
      recsUrl.searchParams.set("target_danceability", String(features.danceability));
    }

    const recsData = await spot(recsUrl.toString());
    const recTracks = recsData?.tracks || [];

    // Build sonic neighborhood from recommendation artists
    const neighborhoodArtists = new Map<string, string>();
    for (const t of recTracks) {
      for (const a of t.artists) {
        if (!neighborhoodArtists.has(a.id)) neighborhoodArtists.set(a.id, a.name);
      }
    }
    for (const a of relatedArtists) neighborhoodArtists.set(a.id, a.name);

    // Step 5: Search Spotify playlists for neighborhood artists
    const playlistMap = new Map<string, any>();
    const artistEntries = Array.from(neighborhoodArtists.entries()).slice(0, 20);

    await Promise.all(artistEntries.map(async ([, artistName]) => {
      try {
        const data = await spot(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(artistName)}&type=playlist&limit=5`
        );
        for (const pl of (data?.playlists?.items || [])) {
          if (!pl?.id) continue;
          const key = `spotify:${pl.id}`;
          if (playlistMap.has(key)) {
            playlistMap.get(key).matched_artists.push(artistName);
          } else {
            playlistMap.set(key, {
              playlist_id: key, platform: "spotify",
              playlist_name: pl.name, curator_name: pl.owner?.display_name || null,
              follower_count: pl.followers?.total || 0, track_count: pl.tracks?.total || 0,
              matched_artists: [artistName], external_url: pl.external_urls?.spotify || null,
            });
          }
        }
      } catch (e) { console.error("Spotify search error:", e); }
    }));

    // Step 6: SoundCloud search
    if (soundcloudClientId) {
      await Promise.all(artistEntries.slice(0, 10).map(async ([, artistName]) => {
        try {
          const data = await fetch(
            `https://api.soundcloud.com/playlists?q=${encodeURIComponent(artistName)}&limit=5&client_id=${soundcloudClientId}`
          ).then((r) => r.json());
          const playlists = Array.isArray(data) ? data : data?.collection || [];
          for (const pl of playlists) {
            if (!pl?.id) continue;
            const key = `soundcloud:${pl.id}`;
            if (playlistMap.has(key)) {
              playlistMap.get(key).matched_artists.push(artistName);
            } else {
              playlistMap.set(key, {
                playlist_id: key, platform: "soundcloud",
                playlist_name: pl.title, curator_name: pl.user?.username || null,
                follower_count: pl.likes_count || 0, track_count: pl.track_count || 0,
                matched_artists: [artistName], external_url: pl.permalink_url || null,
              });
            }
          }
        } catch (e) { console.error("SoundCloud search error:", e); }
      }));
    }

    // Step 7: Fraud detect + rank
    const research_context = {
      audio_features: { tempo: features?.tempo, energy: features?.energy, danceability: features?.danceability, valence: features?.valence },
      neighborhood_artists: Object.fromEntries(neighborhoodArtists),
      related_artists: relatedArtists.map((a: any) => ({ id: a.id, name: a.name })),
    };

    const results = [];
    for (const [, pl] of playlistMap) {
      let fraudScore = 0;
      if (pl.track_count < 3) fraudScore += 40;
      if (pl.follower_count > 1000 && pl.follower_count % 1000 === 0) fraudScore += 20;
      if (["submit","promotion","promo","placement","guaranteed","pay"].some(k => pl.playlist_name?.toLowerCase().includes(k))) fraudScore += 35;
      if (pl.follower_count === 0) fraudScore += 25;
      if (/^playlists*d+$/i.test(pl.playlist_name)) fraudScore += 30;
      if (fraudScore >= 60) continue;
      results.push({
        ...pl, overlap_score: pl.matched_artists.length,
        fraud_score: fraudScore, fraud_verdict: fraudScore >= 30 ? "suspicious" : "safe",
        track_name, research_context, pitch_status: "not_pitched",
      });
    }
    results.sort((a, b) => b.overlap_score - a.overlap_score);
    const top = results.slice(0, 50);

    // Step 8: Upsert into playlist_targets
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (top.length > 0) {
      const { error } = await supabase.from("playlist_targets").upsert(
        top.map(pl => ({
          playlist_id: pl.playlist_id, platform: pl.platform, playlist_name: pl.playlist_name,
          curator_name: pl.curator_name, track_name: pl.track_name, follower_count: pl.follower_count,
          track_count: pl.track_count, overlap_score: pl.overlap_score, fraud_score: pl.fraud_score,
          fraud_verdict: pl.fraud_verdict, pitch_status: pl.pitch_status,
          research_context: pl.research_context, updated_at: new Date().toISOString(),
        })),
        { onConflict: "playlist_id" }
      );
      if (error) console.error("Upsert error:", error.message);
    }

    return json({
      track: { id: trackId, name: track.name, artist: track.artists[0].name },
      audio_features: research_context.audio_features,
      neighborhood_size: neighborhoodArtists.size,
      playlists_found: top.length,
      top_playlists: top.slice(0, 10).map(p => ({
        playlist_id: p.playlist_id, name: p.playlist_name, platform: p.platform,
        followers: p.follower_count, overlap_score: p.overlap_score, fraud_verdict: p.fraud_verdict,
      })),
    });
  } catch (err) {
    console.error("playlist-research error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
