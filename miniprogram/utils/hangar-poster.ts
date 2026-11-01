import type { GundamModel } from './types';

function downloadImage(url: string): Promise<string> {
  if (!url) return Promise.resolve('');
  if (!/^https?:\/\//.test(url)) return Promise.resolve(url);
  return new Promise((resolve) => {
    wx.downloadFile({ url, timeout: 8000, success: (res) => resolve(res.statusCode === 200 ? res.tempFilePath : ''), fail: () => resolve('') });
  });
}

function loadImage(canvas: WechatMiniprogram.Canvas, path: string): Promise<WechatMiniprogram.Image | null> {
  if (!path) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = path;
  });
}

function fitText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  let result = text;
  while (result.length && ctx.measureText(result).width > width) result = result.slice(0, -1);
  return result === text ? result : `${result.slice(0, -1)}…`;
}

export async function generateSquadPoster(page: WechatMiniprogram.Page.TrivialInstance, title: string, models: GundamModel[], captainId: string): Promise<string> {
  const canvas = await new Promise<WechatMiniprogram.Canvas>((resolve, reject) => {
    wx.createSelectorQuery().in(page).select('#hangarPoster').fields({ node: true, size: true }).exec((results) => {
      if (results[0] && results[0].node) resolve(results[0].node);
      else reject(new Error('画布尚未就绪，请重试'));
    });
  });
  canvas.width = 900;
  canvas.height = 1360;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const paths = await Promise.all(models.map((model) => downloadImage(model.imageUrl)));
  const images = await Promise.all(paths.map((path) => loadImage(canvas, path)));
  ctx.fillStyle = '#0a0e17';
  ctx.fillRect(0, 0, 900, 1360);
  ctx.strokeStyle = 'rgba(0,212,255,.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x < 900; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1360); ctx.stroke(); }
  ctx.fillStyle = '#00d4ff';
  ctx.font = '20px monospace';
  ctx.fillText('HANGAR // SQUAD DEPLOYMENT', 48, 62);
  ctx.fillRect(48, 86, 64, 5);
  ctx.fillStyle = '#e8eaf6';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillText(fitText(ctx, title || '我的六机出击', 800), 48, 154);
  ctx.fillStyle = '#8892b0';
  ctx.font = '22px sans-serif';
  ctx.fillText(`${models.length} 台机体集结 · 队长已就位`, 48, 198);
  for (let index = 0; index < 6; index += 1) {
    const model = models[index];
    const x = 48 + (index % 2) * 414;
    const y = 242 + Math.floor(index / 2) * 324;
    ctx.fillStyle = '#141b2d';
    ctx.fillRect(x, y, 390, 300);
    ctx.strokeStyle = model && model.id === captainId ? '#ffaa00' : 'rgba(0,212,255,.3)';
    ctx.strokeRect(x, y, 390, 300);
    ctx.fillStyle = '#00d4ff';
    ctx.font = '18px monospace';
    ctx.fillText(`0${index + 1}`, x + 18, y + 28);
    if (!model) {
      ctx.fillStyle = '#8892b0';
      ctx.font = '22px sans-serif';
      ctx.fillText('预留机位', x + 150, y + 164);
      continue;
    }
    if (model.id === captainId) {
      ctx.fillStyle = '#ffaa00';
      ctx.font = '18px sans-serif';
      ctx.fillText('★ 队长', x + 296, y + 28);
    }
    const image = images[index];
    if (image) {
      const ratio = Math.min(340 / image.width, 180 / image.height);
      const width = image.width * ratio;
      const height = image.height * ratio;
      ctx.drawImage(image, x + (390 - width) / 2, y + 45 + (180 - height) / 2, width, height);
    } else {
      ctx.fillStyle = '#8892b0';
      ctx.font = '22px sans-serif';
      ctx.fillText('机体图像暂缺', x + 126, y + 142);
    }
    ctx.fillStyle = '#00d4ff';
    ctx.font = '17px monospace';
    ctx.fillText(`${model.series.toUpperCase()} / ${model.number}`, x + 18, y + 250);
    ctx.fillStyle = '#e8eaf6';
    ctx.font = '22px sans-serif';
    ctx.fillText(fitText(ctx, model.name, 354), x + 18, y + 282);
  }
  ctx.fillStyle = '#00d4ff';
  ctx.font = '20px sans-serif';
  ctx.fillText('高达模型机库', 48, 1280);
  ctx.fillStyle = '#8892b0';
  ctx.font = '19px sans-serif';
  ctx.fillText('打开好友发送的小程序卡片，查看完整编队', 48, 1318);
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({ canvas, fileType: 'png', success: (res) => resolve(res.tempFilePath), fail: () => reject(new Error('海报导出失败，请重试')) }, page);
  });
}
