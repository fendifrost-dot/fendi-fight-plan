import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { track_name } = await req.json();
    if (!track_name) return Response.json({ error: "track_name required" }, { status: 400 });

    const spotifyClientId = Deno.env.get("SPOTIFY_CLIENT_ID");
    const spotifyClientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET");
    const fanfuelKey = Deno.env.get("FANFUEL_HUB_KEY");

    // Validate auth
    const providedKey = req.headers.get("x-api-key") || 
      req.headers.get("apikey") ||
      (req.headers.get("authorization") || "").replace("Bearer ", "");
    if (!fanfuelKey || providedKey.trim() !== fanfuelKey.trim()) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!spotifyClientId || !spotifyClientSecret) {
      return Response.json({ error: "Spotify credentials not configured" }, { status: 500 });
    }

    // Step 1: Get Spotify access token
    const tokenResp = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + btoa(spotifyClientId + ":" + spotifyClientSecret),
      },
      body: "grant_type=client_credentials",
    });
    const { access_token: spotifyToken } = await tokenResp.json();

    // Step 2: Search for the track to get artist ID
    const searchResp = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(track_name)}&type=track&limit=1`,
      { headers: { Authorization: `Bearer ${spotifyToken}` } }
    );
    const searchData = await searchResp.json();
    const track = searchData?.tracks?.items?.[0];
    const artistId = track?.artists?.[0]?.id;
    const artistName = track?.artists?.[0]?.name || track_name;

    // Step 3: Get artist genres (free endpoint)
    let genres: string[] = [];
    let relatedArtists: string[] = [];
    if (artistId) {
      const artistResp = await fetch(
        `https://api.spotify.com/v1/artists/${artistId}`,
        { headers: { Authorization: `Bearer ${spotifyToken}` } }
      );
      const artistData = await artistResp.json();
      genres = (artistData.genres || []).slice(0, 3);

      // Step 4: Get related artists (free endpoint)
      const relatedResp = await fetch(
        `https://api.spotify.com/v1/artists/${artistId}/related-artists`,
        { headers: { Authorization: `Bearer ${spotifyToken}` } }
      );
      const relatedData = await relatedResp.json();
      relatedArtists = ((relatedData.artists || []) as any[]).slice(0, 3).map((a: any) => a.name);
    }

    // Step 5: Build search terms from track name, artist, genres, related artists
    const searchTerms = [
      track_name,
      artistName,
      ...genres,
      ...relatedArtists.slice(0, 2),
    ].filter(Boolean);

    // Step 6: Search for playlists using those terms (free endpoint)
    const playlists: any[] = [];
    for (const term of searchTerms.slice(0, 4)) {
      const plResp = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(term)}&type=playlist&limit=10`,
        { headers: { Authorization: `Bearer ${spotifyToken}` } }
      );
      const plData = await plResp.json();
      const items = plData?.playlists?.items || [];
      for (const pl of items) {
        if (pl && pl.id && !playlists.find(p => p.playlist_id === `spotify:${pl.id}`)) {
          playlists.push({
            playlist_id: `spotify:${pl.id}`,
            platform: "spotify",
            playlist_name: pl.name,
            curator_name: pl.owner?.display_name || null,
            track_name,
            followers: pl.tracks?.total || 0,
            research_context: { genres, related_artists: relatedArtists, search_term: term, audio_features: null },
          });
        }
      }
    }

    // Step 7: Fraud filter and rank by follower count
    const filtered = playlists
      .filter(p => {
        const name = p.playlist_name?.toLowerCase() || "";
        return !name.includes("submit") && !name.includes("promo") && p.followers > 0;
      })
      .sort((a, b) => b.followers - a.followers)
      .slice(0, 50);

    // Step 8: Upsert into playlist_targets
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && supabaseKey && filtered.length > 0) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      await supabase.from("playlist_targets").upsert(filtered, { onConflict: "playlist_id" });
    }

    return Response.json({ playlists: filtered, total: filtered.length }, { headers: corsHeaders });

  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
  }
});
