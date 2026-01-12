import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Fast document mapping prompt - minimal extraction, max speed
const MAP_PROMPT = `You are a document structure analyzer. Your ONLY job is to quickly identify section boundaries in a credit report.

Analyze the provided pages and output a JSON document map with these sections:
- personal_info: Pages containing name, address, SSN, DOB, employer info
- accounts: Pages containing account listings, creditor names, balances
- inquiries: Pages containing hard/soft inquiry lists
- payment_history: Pages containing payment grids, month-by-month charts
- public_records: Pages containing bankruptcies, liens, judgments
- summary: Pages containing score summary, overview sections

For each section, output:
- start_page: First page number (1-indexed)
- end_page: Last page number (1-indexed) 
- detected: true/false if this section was found
- page_count: Number of pages in this section

Also detect:
- is_multi_bureau: true if Experian/Equifax/TransUnion appear side-by-side
- detected_bureaus: Array of bureau names found
- total_pages: Total page count analyzed
- report_type: "privacyguard" | "identityiq" | "smartcredit" | "experian" | "equifax" | "transunion" | "unknown"

OUTPUT FORMAT (JSON only):
{
  "is_multi_bureau": true,
  "detected_bureaus": ["experian", "equifax", "transunion"],
  "report_type": "privacyguard",
  "total_pages": 25,
  "sections": {
    "personal_info": { "detected": true, "start_page": 1, "end_page": 2, "page_count": 2 },
    "accounts": { "detected": true, "start_page": 3, "end_page": 15, "page_count": 13 },
    "inquiries": { "detected": true, "start_page": 16, "end_page": 17, "page_count": 2 },
    "payment_history": { "detected": true, "start_page": 18, "end_page": 23, "page_count": 6 },
    "public_records": { "detected": false, "start_page": null, "end_page": null, "page_count": 0 },
    "summary": { "detected": true, "start_page": 24, "end_page": 25, "page_count": 2 }
  }
}

IMPORTANT: Be fast. Only scan for section headers and boundaries. Do NOT extract content.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    
    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(JSON.stringify({ error: "Service configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Map document request from user: ${user.id}`);

    const { images } = await req.json();

    if (!images || !Array.isArray(images) || images.length === 0) {
      return new Response(JSON.stringify({ error: "No images provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "Service configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // For mapping, use only first 5 pages + last 2 pages to detect structure quickly
    // This gives us cover page, TOC, section starts, and document end
    const sampleImages: string[] = [];
    const totalPages = images.length;
    
    // First 5 pages (or all if less than 5)
    for (let i = 0; i < Math.min(5, totalPages); i++) {
      sampleImages.push(images[i]);
    }
    
    // Last 2 pages if document is longer than 7 pages
    if (totalPages > 7) {
      sampleImages.push(images[totalPages - 2]);
      sampleImages.push(images[totalPages - 1]);
    }
    
    // Middle sample for long documents (helps detect section transitions)
    if (totalPages > 15) {
      const midPoint = Math.floor(totalPages / 2);
      sampleImages.splice(5, 0, images[midPoint]);
    }

    // Validate and normalize image data URLs
    const validatedImages: string[] = [];
    for (const img of sampleImages) {
      // Ensure the image is a valid base64 data URL with supported format
      if (typeof img !== 'string') continue;
      
      if (img.startsWith('data:image/')) {
        // Extract the MIME type from the data URL
        const mimeMatch = img.match(/^data:(image\/[^;]+);base64,/);
        if (mimeMatch) {
          const mimeType = mimeMatch[1];
          // Supported formats: png, jpeg, gif, webp
          if (['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'].includes(mimeType)) {
            // Normalize image/jpg to image/jpeg for API compatibility
            if (mimeType === 'image/jpg') {
              validatedImages.push(img.replace('data:image/jpg;', 'data:image/jpeg;'));
            } else {
              validatedImages.push(img);
            }
          } else {
            console.warn(`Skipping unsupported image format: ${mimeType}`);
          }
        }
      } else if (img.startsWith('http://') || img.startsWith('https://')) {
        // URL-based images are passed through
        validatedImages.push(img);
      }
    }

    if (validatedImages.length === 0) {
      return new Response(JSON.stringify({ error: "No valid images. Supported formats: PNG, JPEG, GIF, WebP" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userContent: any[] = [
      {
        type: "text",
        text: `Analyze these ${validatedImages.length} sample pages from a ${totalPages}-page credit report. Identify section boundaries and document structure. Output JSON only.`
      }
    ];
    
    for (const img of validatedImages) {
      userContent.push({
        type: "image_url",
        image_url: { url: img }
      });
    }

    // Use fast model for mapping
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5-nano", // Fast model for structure detection
        messages: [
          { role: "system", content: MAP_PROMPT },
          { role: "user", content: userContent }
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("Map document AI error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "Failed to map document" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      return new Response(JSON.stringify({ error: "No mapping result" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let documentMap;
    try {
      documentMap = JSON.parse(content);
    } catch {
      console.error("Failed to parse document map:", content);
      // Return a fallback map that processes everything in chunks
      documentMap = {
        is_multi_bureau: false,
        detected_bureaus: [],
        report_type: "unknown",
        total_pages: totalPages,
        sections: {
          personal_info: { detected: true, start_page: 1, end_page: 2, page_count: 2 },
          accounts: { detected: true, start_page: 3, end_page: Math.min(totalPages, 15), page_count: Math.min(totalPages - 2, 13) },
          inquiries: { detected: true, start_page: Math.min(totalPages - 4, 16), end_page: Math.min(totalPages - 2, 20), page_count: 3 },
          payment_history: { detected: false, start_page: null, end_page: null, page_count: 0 },
          public_records: { detected: false, start_page: null, end_page: null, page_count: 0 },
          summary: { detected: true, start_page: totalPages, end_page: totalPages, page_count: 1 }
        }
      };
    }

    // Ensure total_pages is set
    documentMap.total_pages = totalPages;

    console.log(`Document mapped: ${totalPages} pages, multi-bureau: ${documentMap.is_multi_bureau}`);

    return new Response(JSON.stringify(documentMap), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in map-document function:", error);
    return new Response(JSON.stringify({ error: "Failed to map document" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
