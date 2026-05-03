import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import AppNavigation from "@/components/AppNavigation";

const FN = (name: string) =>
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;

export default function Intake() {
  const { toast } = useToast();
  const [session, setSession] = useState<unknown>(null);
  const [clients, setClients] = useState<{ id: string; status: string; created_at: string }[]>([]);
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);

  const [legalName, setLegalName] = useState("");
  const [dob, setDob] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [quotedFee, setQuotedFee] = useState("1750");
  const [depositAmt, setDepositAmt] = useState("500");
  const [depositDue, setDepositDue] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const headers = useCallback(async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    setSession(s);
    const token = s?.access_token;
    if (!token) throw new Error("Not signed in");
    return {
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    };
  }, []);

  const loadClients = useCallback(async () => {
    try {
      const h = await headers();
      const { data, error } = await supabase
        .from("intake_clients")
        .select("id, status, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setClients((data || []) as { id: string; status: string; created_at: string }[]);
    } catch (e) {
      console.error(e);
    }
  }, [headers]);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  const onCreateCanonical = async () => {
    setBusy(true);
    try {
      const h = await headers();
      const parts = legalName.trim().split(/\s+/);
      const res = await fetch(FN("intake-create-canonical"), {
        method: "POST",
        headers: { ...h, "Content-Type": "application/json" },
        body: JSON.stringify({
          canonical: {
            legalName: legalName.trim(),
            legalNameFirst: parts[0] || "",
            legalNameLast: parts[parts.length - 1] || "",
            dob,
            currentAddress: { line1, line2: line2 || undefined, city, state: state.toUpperCase().slice(0, 2), zip },
            phone,
            email,
          },
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      setClientId(j.clientId);
      toast({ title: "Baseline saved", description: j.clientId });
      await loadClients();
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const onUploadPdfs = async (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!clientId) {
      toast({ title: "Create client first", variant: "destructive" });
      return;
    }
    const form = ev.currentTarget;
    const fd = new FormData(form);
    fd.set("clientId", clientId);
    setBusy(true);
    try {
      const h = await headers();
      const res = await fetch(FN("intake-ingest-bureau-pdfs"), {
        method: "POST",
        headers: { Authorization: h.Authorization, apikey: h.apikey },
        body: fd,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      toast({ title: "Bureau PDFs ingested" });
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const onScore = async () => {
    if (!clientId) return;
    setBusy(true);
    try {
      const h = await headers();
      const res = await fetch(FN("intake-score-file"), {
        method: "POST",
        headers: { ...h, "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      toast({
        title: "File scored",
        description: `Score ${j.pricingRecommendation?.score} — ${j.pricingRecommendation?.tier?.name}`,
      });
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const onApprove = async () => {
    if (!clientId) return;
    setBusy(true);
    try {
      const h = await headers();
      const res = await fetch(FN("intake-approve-pricing"), {
        method: "POST",
        headers: { ...h, "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          quotedFee: Number(quotedFee),
          overrideReason: overrideReason.trim() || undefined,
          payment: {
            deposit: { amount: Number(depositAmt), dueBy: depositDue || new Date().toISOString().slice(0, 10) },
          },
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      toast({ title: "Pricing approved", description: `Net ${j.record?.pricingApproved?.netTotal}` });
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const onGenerate = async () => {
    if (!clientId) return;
    setBusy(true);
    try {
      const h = await headers();
      const res = await fetch(FN("intake-generate-summary"), {
        method: "POST",
        headers: { ...h, "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      toast({ title: "Documents generated", description: JSON.stringify(j.artifacts) });
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const onRecordPayment = async () => {
    if (!clientId) return;
    setBusy(true);
    try {
      const h = await headers();
      const res = await fetch(FN("payments-record"), {
        method: "POST",
        headers: { ...h, "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          amount: Number(depositAmt),
          method: "manual",
          date: new Date().toISOString().slice(0, 10),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      toast({ title: "Payment recorded", description: `Remaining ${j.paymentPlan?.remainingBalance}` });
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppNavigation />
      <main className="container max-w-5xl py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New client intake</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Operator baseline, bureau PDF ingest, rubric scoring, approval gate, document generation, and payments.
          </p>
        </div>

        {!session && (
          <Card>
            <CardHeader>
              <CardTitle>Sign in required</CardTitle>
            </CardHeader>
            <CardContent>
              <a href="/auth" className="text-primary underline">Go to auth</a>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Recent intake clients</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void loadClients()}>
                Refresh
              </Button>
            </div>
            <ul className="text-sm space-y-1">
              {clients.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="text-left underline-offset-2 hover:underline"
                    onClick={() => setClientId(c.id)}
                  >
                    {c.id.slice(0, 8)}… — {c.status} — {new Date(c.created_at).toLocaleString()}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 items-end pt-2">
              <div className="flex-1">
                <Label>Active client ID</Label>
                <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="UUID" />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-3 gap-6">
          <Card className="md:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">1. Canonical baseline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Legal name</Label>
                <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} />
              </div>
              <div>
                <Label>DOB (YYYY-MM-DD)</Label>
                <Input value={dob} onChange={(e) => setDob(e.target.value)} />
              </div>
              <div>
                <Label>Address line 1</Label>
                <Input value={line1} onChange={(e) => setLine1(e.target.value)} />
              </div>
              <div>
                <Label>Line 2</Label>
                <Input value={line2} onChange={(e) => setLine2(e.target.value)} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Label>City</Label>
                  <Input value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
                <div>
                  <Label>ST</Label>
                  <Input value={state} onChange={(e) => setState(e.target.value)} maxLength={2} />
                </div>
              </div>
              <div>
                <Label>ZIP</Label>
                <Input value={zip} onChange={(e) => setZip(e.target.value)} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <Button disabled={busy} onClick={() => void onCreateCanonical()}>
                Save baseline
              </Button>
            </CardContent>
          </Card>

          <Card className="md:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">2. Bureau PDFs</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={onUploadPdfs}>
                <div>
                  <Label>Equifax</Label>
                  <Input name="equifax" type="file" accept="application/pdf" />
                </div>
                <div>
                  <Label>Experian</Label>
                  <Input name="experian" type="file" accept="application/pdf" />
                </div>
                <div>
                  <Label>TransUnion</Label>
                  <Input name="transunion" type="file" accept="application/pdf" />
                </div>
                <Button type="submit" disabled={busy} variant="secondary">
                  Upload & parse
                </Button>
              </form>
              <Button className="mt-4 w-full" variant="outline" type="button" disabled={busy || !clientId} onClick={() => void onScore()}>
                Recompute score
              </Button>
            </CardContent>
          </Card>

          <Card className="md:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">3. Approve & generate</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Quoted fee (750–2500)</Label>
                <Input value={quotedFee} onChange={(e) => setQuotedFee(e.target.value)} />
              </div>
              <div>
                <Label>Deposit amount</Label>
                <Input value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} />
              </div>
              <div>
                <Label>Deposit due (YYYY-MM-DD)</Label>
                <Input value={depositDue} onChange={(e) => setDepositDue(e.target.value)} />
              </div>
              <div>
                <Label>Override reason (if outside tier)</Label>
                <Textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} rows={3} />
              </div>
              <Button disabled={busy || !clientId} onClick={() => void onApprove()}>
                Approve & open payment plan
              </Button>
              <Button disabled={busy || !clientId} variant="default" className="w-full" onClick={() => void onGenerate()}>
                Generate summary + pricing card
              </Button>
              <Button disabled={busy || !clientId} variant="outline" className="w-full" onClick={() => void onRecordPayment()}>
                Record test payment (deposit amount)
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
