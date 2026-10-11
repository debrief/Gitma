import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import gates from "../generated/gates.json";

const PLAN = [
  [
    "G0 — pipeline",
    "Classical solver recovers noise-free truth; naive baseline reproduces",
    "Fix the generator before any training",
  ],
  [
    "G1 — signal exists",
    "Model median range error < 50% of the naive baseline's, both variants",
    "Stop: report and close",
  ],
  [
    "G2 — useful",
    "Median range error < 20%, course < 10°, speed < 1 kt at σ = 1°",
    "One more iteration, then stop",
  ],
  [
    "G3 — classical parity",
    "Within 1.2× classical on every metric, lower gross-error rate",
    "Not a stop; sets the next bar",
  ],
];

function GateStatus() {
  if (gates.length === 0) return <p>No gate has been judged yet.</p>;
  return (
    <table className="gate-table">
      <thead>
        <tr>
          <th>Experiment</th>
          <th>Gate</th>
          <th>Verdict</th>
          <th>Decided by</th>
        </tr>
      </thead>
      <tbody>
        {gates.map((g) => (
          <tr key={g.id}>
            <td>
              <a href={`https://github.com/debrief/Gitma/tree/main/experiments/${g.id}`}>
                <code>{g.id}</code>
              </a>
            </td>
            <td>{g.gate}</td>
            <td className={`gate-${g.result}`}>{g.result}</td>
            <td>{g.decided_by}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title="Welcome" description={siteConfig.tagline}>
      <main className="container margin-vert--lg">
        <h1>{siteConfig.title}</h1>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <p>
          This is a proof of concept, not a product. A neural network is trained on large volumes of
          simulated bearings-only data, and asked to estimate a target's range, course and speed.
          Each iteration ends at a gate; a failed early gate ends the project with a short write-up.
        </p>

        <h2>Current gate status</h2>
        <GateStatus />
        <p>
          Machine verdicts come from <code>experiments/*/verdict.json</code>. An agent review panel
          (five independent specialist reviewers, iterated until none rejects) takes the decision;
          its record is <code>review.md</code> in the experiment folder.
        </p>

        <h2>The plan</h2>
        <table className="gate-table">
          <thead>
            <tr>
              <th>Gate</th>
              <th>Criterion</th>
              <th>If failed</th>
            </tr>
          </thead>
          <tbody>
            {PLAN.map(([gate, criterion, fail]) => (
              <tr key={gate}>
                <td>{gate}</td>
                <td>{criterion}</td>
                <td>{fail}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Read more</h2>
        <ul>
          <li>
            <Link to="/blog">Blog</Link>: one post per iteration, with the gate decision.
          </li>
          <li>
            <Link to="/docs/glossary">Glossary</Link> of TMA and ML terms as used here.
          </li>
          <li>
            <Link to="/docs/data-dictionary">Data dictionary</Link>, generated from the schema.
          </li>
          <li>
            <Link to="/docs/algorithms/generator">Algorithms</Link>: generator, features, baselines.
          </li>
          <li>
            <Link to="/docs/evaluation">Evaluation and gates</Link>: metric definitions.
          </li>
          <li>
            <Link to="/docs/results/iteration-1">Results</Link>: iteration-1 models beside the
            baselines, with error-vs-time curves.
          </li>
        </ul>
      </main>
    </Layout>
  );
}
