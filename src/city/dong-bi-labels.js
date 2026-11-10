const BI_ID = /^seogu-(?:0[1-9]|1[0-8])$/;

// Cache the official images and rasterize each badge once per size and selection state.
export function createDongBiLabels(onChange) {
  const images = new Map(), badges = new Map();
  let frame = null;

  function imageFor(id) {
    if (!images.has(id)) {
      const image = new Image();
      images.set(id, image);
      image.onload = () => {
        if (frame !== null) return;
        frame = requestAnimationFrame(() => { frame = null; onChange(); });
      };
      image.src = `/brand/dongs/${id}.png`;
    }
    return images.get(id);
  }

  function get(id, name, fontPx, selected) {
    if (!BI_ID.test(id)) return null;
    const image = imageFor(id);
    if (!image.naturalWidth || !image.naturalHeight) return null;
    const key = JSON.stringify([id, name, fontPx, selected]);
    if (badges.has(key)) return badges.get(key);

    const width = fontPx * 5 + 4, imageHeight = fontPx * 3;
    const height = imageHeight + fontPx + 14;
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    ctx.beginPath();
    ctx.roundRect(1, 1, width - 2, height - 2, 8);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeStyle = selected ? '#0752a7' : '#567695';
    ctx.stroke();

    const scale = Math.min((width - 12) / image.naturalWidth, imageHeight / image.naturalHeight);
    const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
    ctx.drawImage(image, (width - w) / 2, 5 + (imageHeight - h) / 2, w, h);
    ctx.font = `${selected ? 800 : 600} ${fontPx}px sans-serif`;
    ctx.fillStyle = selected ? '#0752a7' : '#102b46';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, width / 2, imageHeight + 8 + fontPx / 2);

    const badge = {canvas, width, height};
    badges.set(key, badge);
    return badge;
  }

  return {
    get,
    destroy() {
      for (const image of images.values()) image.onload = null;
      if (frame !== null) cancelAnimationFrame(frame);
      images.clear();
      badges.clear();
    }
  };
}
