import { VercelRequest, VercelResponse } from '@vercel/node';

declare global {
  // Cache na instância quente da função
  var __spotifyCache__: { data: any; lastUpdated: number } | undefined;
}

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

async function getAccessToken(): Promise<string> {
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!resp.ok) throw new Error(`Erro ao obter token Spotify: ${resp.status}`);

  const json = await resp.json();
  return json.access_token;
}

async function fetchSpotifyFull(artistId: string) {
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}` };

  // Buscar artista
  const artistResp = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, { headers });
  if (!artistResp.ok) throw new Error(`Erro ao buscar artista: ${artistResp.status}`);
  const artist = await artistResp.json();

  // Buscar álbuns
  const albumsResp = await fetch(
    `https://api.spotify.com/v1/artists/${artistId}/albums?include_groups=album,single&market=BR&limit=50`,
    { headers }
  );
  if (!albumsResp.ok) throw new Error(`Erro ao buscar álbuns: ${albumsResp.status}`);
  const albumsJson = await albumsResp.json();

  const albums = Array.isArray(albumsJson.items) ? albumsJson.items : [];

  // Para cada álbum, buscar as tracks e adicionar as imagens do álbum em cada track
  const albumsWithTracks = await Promise.all(
    albums.map(async (album: any) => {
      const tracksResp = await fetch(`https://api.spotify.com/v1/albums/${album.id}/tracks`, { headers });
      if (!tracksResp.ok) throw new Error(`Erro ao buscar tracks do álbum ${album.id}: ${tracksResp.status}`);
      const tracksJson = await tracksResp.json();

      const tracksWithAlbumImages = Array.isArray(tracksJson.items)
        ? tracksJson.items.map((track: any) => ({
            id: track.id,
            name: track.name,
            preview_url: track.preview_url,
            duration_ms: track.duration_ms,
            artists: track.artists,
            albumImages: album.images,
            album: {
              id: album.id,
              name: album.name,
              release_date: album.release_date
            }
          }))
        : [];

      return {
        ...album,
        tracks: tracksWithAlbumImages
      };
    })
  );

  // Criar um array plano de todas as tracks de todos os álbuns com imagens
  const allTracks = albumsWithTracks.flatMap(album => album.tracks);

  return { artist, albums: albumsWithTracks, tracks: allTracks };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // === CORS Headers ===
  res.setHeader('Access-Control-Allow-Origin', '*'); // para produção, substitua '*' pelo domínio do seu frontend
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-cache-secret');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Verificação do segredo para segurança (passado via query ou header)
  const providedSecret = (req.headers['x-cache-secret'] as string) || (req.query?.secret as string);
  if (process.env.CRON_SECRET && providedSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized: segredo inválido' });
  }

  const ARTIST_ID = process.env.ARTIST_ID;
  if (!ARTIST_ID) return res.status(500).json({ error: 'ARTIST_ID não configurado' });

  try {
    const now = Date.now();

    const globalCache = globalThis.__spotifyCache__;
    if (globalCache && now - globalCache.lastUpdated < CACHE_TTL_MS) {
      return res.status(200).json({ lastUpdated: globalCache.lastUpdated, data: globalCache.data, fromCache: true });
    }

    const data = await fetchSpotifyFull(ARTIST_ID);

    globalThis.__spotifyCache__ = { data, lastUpdated: now };

    return res.status(200).json({ lastUpdated: now, data, fromCache: false });
  } catch (err: any) {
    console.error('Erro em cache-artist-tracks:', err);
    return res.status(500).json({ error: 'Erro ao buscar dados do Spotify', details: err?.message || err });
  }
}
