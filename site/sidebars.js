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
      ],
    },
  ],
};

export default sidebars;
