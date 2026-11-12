export function mediaArtwork(src: string): Promise<MediaImage[]> {
  if (!src) return Promise.resolve([]);
  return new Promise(resolve => {
    const image = new Image();
    const fallback = [{src}];
    const finish = (artwork: MediaImage[]) => {
      clearTimeout(timer);
      image.onload = image.onerror = null;
      resolve(artwork);
    };
    const timer = window.setTimeout(() => finish(fallback), 8000);
    image.crossOrigin = 'anonymous';
    image.onerror = () => finish(fallback);
    image.onload = async () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 512;
        const context = canvas.getContext('2d');
        if (!context || !image.naturalWidth || !image.naturalHeight) return finish(fallback);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, 512, 512);
        const scale = Math.min(512 / image.naturalWidth, 512 / image.naturalHeight);
        const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
        context.drawImage(image, (512 - width) / 2, (512 - height) / 2, width, height);
        const jpeg = canvas.toDataURL('image/jpeg', 0.85);
        if (!jpeg.startsWith('data:image/jpeg;base64,')) return finish(fallback);
        const response=await fetch('/api/artwork',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({jpeg:jpeg.slice('data:image/jpeg;base64,'.length)})});
        if (!response.ok) return finish(fallback);
        const published=await response.json() as {url:string};
        finish([{src:published.url,sizes:'512x512',type:'image/jpeg'}]);
      } catch {
        finish(fallback);
      }
    };
    const source = new URL(src,window.location.href);
    image.src = source.origin===window.location.origin ? source.href : `/api/artwork?url=${encodeURIComponent(source.href)}`;
  });
}
