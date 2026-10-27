/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: [
    "glossary",
    "data-dictionary",
    "evaluation",
    {
      type: "category",
      label: "Algorithms",
      items: [
        "algorithms/generator",
        "algorithms/feature-layout",
        "algorithms/naive-baseline",
        "algorithms/least-squares-solver",
        "algorithms/models",
        "algorithms/hybrid",
        "algorithms/viewer",
      ],
    },
    {
      type: "category",
      label: "Results",
      items: [
        "results/iteration-1",
        "results/iteration-2",
        "results/iteration-2b",
        "results/iteration-2c",
        "results/iteration-3",
        "results/iteration-4",
      ],
    },
  ],
};

export default sidebars;
