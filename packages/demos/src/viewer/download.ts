// Exports (spec 006 FR-008): SVGs to one PNG, text to a file. Browser only.

function save(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
  }, 1000);
}

export function saveText(text: string, name: string, type = "application/x-ndjson"): void {
  save(new Blob([text], { type }), name);
}

const size = (svg: SVGSVGElement): { w: number; h: number } => {
  const vb = svg.viewBox.baseVal;
  return { w: vb.width || svg.clientWidth, h: vb.height || svg.clientHeight };
};

/** Stack the SVGs vertically into one PNG at `scale` × their viewBox size. */
export async function savePng(svgs: SVGSVGElement[], name: string, scale = 2): Promise<void> {
  const parts = svgs.map((s) => ({ s, ...size(s) }));
  const width = Math.max(...parts.map((p) => p.w));
  const height = parts.reduce((h, p) => h + p.h, 0);
  let y = 0;
  const body = parts
    .map((p) => {
      const clone = p.s.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("x", "0");
      clone.setAttribute("y", String(y));
      clone.setAttribute("width", String(p.w));
      clone.setAttribute("height", String(p.h));
      y += p.h;
      return new XMLSerializer().serializeToString(clone);
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        resolve();
      };
      img.onerror = () => {
        reject(new Error("could not render the SVG"));
      };
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("no 2D canvas");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });
    if (blob === null) throw new Error("PNG encoding failed");
    save(blob, name);
  } finally {
    URL.revokeObjectURL(url);
  }
}
