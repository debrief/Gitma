// The engagement and model viewer (SRD Annex A Part A, spec 006). Browser only: scenarios are
// regenerated and the models run in the page, so the server render shows a placeholder.
import BrowserOnly from "@docusaurus/BrowserOnly";
import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";
import Layout from "@theme/Layout";
import { lazy, Suspense } from "react";
import catalogue from "../generated/viewer.json";

const EngagementViewer = lazy(() =>
  import("@tma/demos/viewer").then((m) => ({ default: m.EngagementViewer })),
);

export default function Viewer() {
  const models = useBaseUrl("/viewer/models");
  const loading = <p>Loading the viewer…</p>;
  return (
    <Layout
      title="Engagement viewer"
      description="Regenerate any test or held-out engagement and see the carried models' estimates beside the classical solver and the naive baseline."
    >
      <main className="container margin-vert--md">
        <h1>Engagement viewer</h1>
        <p>
          Pick a dataset and a scenario: the page regenerates it from its seed with the
          pipeline&apos;s own generator and runs each gate&apos;s carried models in your browser.{" "}
          <strong>Truth</strong> shows the engagement. <strong>Instantaneous</strong> shows the
          causal model&apos;s estimate at the cursor, from the bearings up to then.{" "}
          <strong>Time-late</strong> shows the bidirectional model&apos;s track over the whole
          window. The classical solver and the naive baseline sit beside every model figure. The
          link in the address bar reopens this view. How it works:{" "}
          <Link to="/docs/algorithms/viewer">the viewer</Link>.
        </p>
        <BrowserOnly fallback={loading}>
          {() => (
            <Suspense fallback={loading}>
              <EngagementViewer
                catalogue={catalogue}
                modelBaseUrl={models}
                initialSearch={window.location.search}
                syncUrl
              />
            </Suspense>
          )}
        </BrowserOnly>
      </main>
    </Layout>
  );
}
