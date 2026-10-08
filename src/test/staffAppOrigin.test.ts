import { describe, expect, it } from "vitest";
import { isStaffAppOrigin } from "../../supabase/functions/_shared/staff-cors";

const PROJECT = "bfe3ffa4-da7d-42ae-ab36-7b020e50ac3c";

describe("isStaffAppOrigin", () => {
  it("allows the published Compass app and its Lovable previews", () => {
    expect(isStaffAppOrigin("https://fendi-fight-plan.lovable.app")).toBe(true);
    expect(isStaffAppOrigin(`https://id-preview--${PROJECT}.lovable.app`)).toBe(true);
    expect(isStaffAppOrigin(`https://abc123--${PROJECT}.lovable.app`)).toBe(true);
  });

  it("rejects other sites, other Lovable apps, and non-https origins", () => {
    expect(isStaffAppOrigin("https://fairway-fixer-18.lovable.app")).toBe(false);
    expect(isStaffAppOrigin("https://evil.lovable.app")).toBe(false);
    expect(isStaffAppOrigin("http://fendi-fight-plan.lovable.app")).toBe(false);
    expect(isStaffAppOrigin("https://fendi-fight-plan.lovable.app.evil.com")).toBe(false);
    expect(isStaffAppOrigin("")).toBe(false);
  });
});
