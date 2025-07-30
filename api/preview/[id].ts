import { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query;
  const cloudName = process.env.CLOUDINARY_NAME;

  if (!id || typeof id !== 'string') {
    return res.status(400).send('ID inválido');
  }

  if (!cloudName) {
    return res.status(500).send('Cloudinary name não configurado');
  }

  const imageUrl = `https://res.cloudinary.com/${cloudName}/image/upload/${id}.png`;
  const pageUrl = `https://rank-my-diego-vercel.vercel.app/api/preview/${encodeURIComponent(id)}`;

  const html = `
    <!DOCTYPE html>
    <html lang="pt">
    <head>
      <meta charset="UTF-8" />
      <title>Ranking Diego Martins</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta property="og:title" content="Meu Ranking da Diego Martins 🎤✨" />
      <meta property="og:description" content="Veja meu ranking das músicas favoritas!" />
      <meta property="og:image" content="${imageUrl}" />
      <meta property="og:url" content="${pageUrl}" />
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:image" content="${imageUrl}" />
    </head>
    <body>
      <h1>Meu Ranking da Diego Martins</h1>
      <img src="${imageUrl}" alt="Ranking" style="max-width: 100%; border-radius: 12px;" />
    </body>
    </html>
  `;

  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(html);
}


// import { VercelRequest, VercelResponse } from '@vercel/node';

// export default function handler(req: VercelRequest, res: VercelResponse) {
//   const { id } = req.query;

//   res.status(200).send(`ID recebido: ${id}`);
// }

