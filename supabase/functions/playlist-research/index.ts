import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

const ARTIST_DNA = {
  core_sound: ["Larry June", "Dom Kennedy", "Freddie Gibbs", "Stove God Cooks", "Boldy James"],
  bigger_comps: ["Nipsey Hussle", "Wale", "J Cole"],
  drill_roots: ["G Herbo", "Young Pappy"],
  smaller_comps: ["Pirate Reem", "Joel Q"],
};

function allDna() {
  return [...ARTIST_DNA.core_sound, ...ARTIST_DNA.bigger_comps, ...ARTIST_DNA.drill_roots, ...ARTIST_DNA.smaller_comps];
}

function jsonRes(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getHubKey(req) {
  return req.headers.get("x-api-key") || req.headers.get("apikey") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

function computeBot(name, followers, trackCount) {
  let score = 0;
  const flags = [];
  const n = (name || "").toLowerCase();
  if (followers > 50000 && followers % 10000 === 0) { score += 25; flags.push("round_followers"); }
  if (["submit", "promotion", "promo", "placement", "guaranteed", "pay", "playlist push"].some(k => n.includes(k))) {
    score += 35; flags.push("pay_to_play");
  }
  if ((trackCount || 999) < 3) { score += 20; flags.push("tiny_playlist"); }
  if (followers === 0) { score += 15; flags.push("zero_followers"); }
  return { bot_score: Math.min(100, score), bot_flags: flags };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let body = {};
    try { body = await req.json(); } catch (_) {}
    const track_name = (body.track_name || "").trim();
    const user_vibe = (body.user_vibe || "").trim();
    if (!track_name) return jsonRes({ error: "track_name required" }, 400);

    const expected = Deno.env.get("FANFUEL_HUB_KEY");
    if (!expected || getHubKey(req).trim() !== expected.trim()) return jsonRes({ error: "Unauthorized" }, 401);

    const cid = Deno.env.get("SPOTIFY_CLIENT_ID");
    const csec = Deno.env.get("SPOTIFY_CLIENT_SECRET");
    if (!cid || !csec) return jsonRes({ error: "Spotify credentials not configured" }, 500);

    const tokenResp = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Authorization": "Basic " + btoa(cid + ":" + csec) },
      body: "grant_type=client_credentials",
    });
    if (!tokenResp.ok) { const t = await tokenResp.text(); return jsonRes({ error: "Spotify token failed", detail: t.slice(0, 200) }, 502); }
    const { access_token: token } = await tokenResp.json();
    if (!token) return jsonRes({ error: "Spotify token missing" }, 502);
    const H = { Authorization: "Bearer " + token };

    const trackData = await fetch("https://api.spotify.com/v1/search?q=" + encodeURIComponent(track_name) + "&type=track&limit=3", { headers: H })
      .then(r => r.json()).catch(() => ({}));
    const track = trackData?.tracks?.items?.[0];
    const artistName = track?.artists?.[0]?.name || "";

    const terms = [...new Set([track_name, artistName, user_vibe, ...allDna()].filter(Boolean))].slice(0, 16);
    const seen = new Map();

    for (const term of terms) {
      const resp = await fetch("https://api.spotify.com/v1/search?q=" + encodeURIComponent(term) + "&type=playlist&limit=10", { headers: H });
      if (!resp.ok) continue;
      const data = await resp.json().catch(() => ({}));
      for (const pl of data?.playlists?.items || []) {
        if (!pl?.id) continue;
        const pid = "spotify:" + pl.id;
        if (seen.has(pid)) { seen.get(pid).matched_queries.push(term); continue; }
        const followers = pl.followers?.total ?? pl.tracks?.total ?? 0;
        const tc = pl.tracks?.total ?? 0;
        const { bot_score, bot_flags } = computeBot(pl.name, followers, tc);
        seen.set(pid, {
          playlist_id: pid, platform: "spotify", playlist_name: pl.name, name: pl.name,
          curator_name: pl.owner?.display_name ?? null, followers, track_count: tc,
          matched_queries: [term], bot_score, bot_flags,
          research_context: { search_term: term, artist_dna: ARTIST_DNA, user_vibe: user_vibe || null, audio_features: null },
        });
      }
    }

    const scId = Deno.env.get("SOUNDCLOUD_CLIENT_ID");
    if (scId) {
      for (const term of terms.slice(0, 6)) {
        const resp = await fetch("https://api.soundcloud.com/playlists?q=" + encodeURIComponent(term) + "&limit=5&client_id=" + encodeURIComponent(scId));
        if (!resp.ok) continue;
        const list = await resp.json().catch(() => []);
        for (const pl of (Array.isArray(list) ? list : list?.collection || [])) {
          if (!pl?.id) continue;
          const pid = "soundcloud:" + pl.id;
          if (seen.has(pid)) { seen.get(pid).matched_queries.push(term); continue; }
          const followers = pl.likes_count || 0;
          const tc = pl.track_count || 0;
          const { bot_score, bot_flags } = computeBot(pl.title, followers, tc);
          seen.set(pid, {
            playlist_id: pid, platform: "soundcloud", playlist_name: pl.title, name: pl.title,
            curator_name: pl.user?.username ?? null, followers, track_count: tc,
            matched_queries: [term], bot_score, bot_flags,
            research_context: { search_term: term, artist_dna: ARTIST_DNA, user_vibe: user_vibe || null },
          });
        }
      }
    }

    const rows = [...seen.values()]
      .filter(r => r.bot_score < 70)
      .sort((a, b) => (b.matched_queries.length - a.matched_queries.length) || (b.followers - a.followers))
      .slice(0, 50);

    const sbUrl = Deno.env.get("SUPABASE_URL");
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (sbUrl && sbKey && rows.length > 0) {
      try {
        const sb = createClient(sbUrl, sbKey);
        await sb.from("playlist_targets").upsert(
          rows.map(r => ({
            playlist_id: r.playlist_id, platform: r.platform, playlist_name: r.playlist_name,
            curator_name: r.curator_name, track_name, follower_count: r.followers,
            track_count: r.track_count, overlap_score: r.matched_queries.length,
            fraud_score: r.bot_score, fraud_verdict: r.bot_score >= 40 ? "suspicious" : "safe",
            pitch_status: "not_pitched", research_context: { ...r.research_context, matched_queries: r.matched_queries, bot_flags: r.bot_flags },
          })),
          { onConflict: "playlist_id" }
        );
      } catch (e) { console.error("upsert:", e); }
    }

    return jsonRes({
      track: track ? { id: track.id, name: track.name, artist: artistName } : { name: track_name, artist: artistName },
      artist_dna: ARTIST_DNA,
      playlists: rows.map(r => ({ playlist_id: r.playlist_id, name: r.name, followers: r.followers, platform: r.platform, bot_score: r.bot_score, bot_flags: r.bot_flags, overlap_score: r.matched_queries.length })),
      total: rows.length,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
