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
    const providedKey = req.headers.get("x-api-key") || req.headers.get("apikey") || (req.headers.get("authorization") || "").replace("Bearer ", "");
    if (!fanfuelKey || providedKey.trim() !== fanfuelKey.trim()) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!spotifyClientId || !spotifyClientSecret) {
      return Response.json({ error: "Spotify credentials not configured" }, { status: 500 });
    }
    const tokenResp = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(spotifyClientId + ":" + spotifyClientSecret) },
      body: "grant_type=client_credentials",
    });
    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      return Response.json({ error: "Spotify auth failed: " + errText.slice(0, 200) }, { status: 502 });
    }
    const { access_token: spotifyToken } = await tokenResp.json();
    const trackSearchUrl = "https://api.spotify.com/v1/search?q=" + encodeURIComponent(track_name) + "&type=track&limit=3";
    const searchResp = await fetch(trackSearchUrl, { headers: { Authorization: "Bearer " + spotifyToken } });
    if (!searchResp.ok) {
      return Response.json({ error: "Spotify track search failed: " + searchResp.status }, { status: 502 });
    }
    const searchData = await searchResp.json();
    const track = searchData.tracks && searchData.tracks.items && searchData.tracks.items[0];
    const artistId = track && track.artists && track.artists[0] && track.artists[0].id;
    const artistName = (track && track.artists && track.artists[0] && track.artists[0].name) || track_name;
    let genres = [];
    let relatedArtists = [];
    if (artistId) {
      const artistResp = await fetch("https://api.spotify.com/v1/artists/" + artistId, { headers: { Authorization: "Bearer " + spotifyToken } });
      if (artistResp.ok) { const d = await artistResp.json(); genres = (d.genres || []).slice(0, 3); }
      const relatedResp = await fetch("https://api.spotify.com/v1/artists/" + artistId + "/related-artists", { headers: { Authorization: "Bearer " + spotifyToken } });
      if (relatedResp.ok) { const d = await relatedResp.json(); relatedArtists = (d.artists || []).slice(0, 3).map(function(a) { return a.name; }); }
    }
    const searchTerms = [track_name, artistName].concat(genres).concat(relatedArtists.slice(0, 2)).filter(Boolean);
    const playlists = [];
    for (let i = 0; i < Math.min(searchTerms.length, 4); i++) {
      const term = searchTerms[i];
      const plUrl = "https://api.spotify.com/v1/search?q=" + encodeURIComponent(term) + "&type=playlist&limit=10";
      const plResp = await fetch(plUrl, { headers: { Authorization: "Bearer " + spotifyToken } });
      if (!plResp.ok) continue;
      const plData = await plResp.json();
      const items = (plData.playlists && plData.playlists.items) || [];
      for (let j = 0; j < items.length; j++) {
        const pl = items[j];
        if (!pl || !pl.id) continue;
        const pid = "spotify:" + pl.id;
        if (playlists.find(function(p) { return p.playlist_id === pid; })) continue;
        const followerCount = (pl.followers && pl.followers.total) || (pl.tracks && pl.tracks.total) || 0;
        playlists.push({
          playlist_id: pid, platform: "spotify", playlist_name: pl.name, name: pl.name,
          curator_name: (pl.owner && pl.owner.display_name) || null,
          track_name: track_name, followers: followerCount,
          research_context: { genres: genres, related_artists: relatedArtists, search_term: term, audio_features: null },
        });
      }
    }
    const filtered = playlists
      .filter(function(p) { const n = (p.name || "").toLowerCase(); return !n.includes("submit") && !n.includes("promo") && p.followers > 0; })
      .sort(function(a, b) { return b.followers - a.followers; })
      .slice(0, 50);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && supabaseKey && filtered.length > 0) {
      const sb = createClient(supabaseUrl, supabaseKey);
      const res = await sb.from("playlist_targets").upsert(filtered, { onConflict: "playlist_id" });
      if (res.error) console.error("Upsert error:", res.error.message);
    }
    return Response.json({ playlists: filtered, total: filtered.length }, { headers: corsHeaders });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
  }
});
