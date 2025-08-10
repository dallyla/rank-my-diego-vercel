import { VercelRequest, VercelResponse } from '@vercel/node';

declare global {
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
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!resp.ok) throw new Error(`Erro ao obter token Spotify: ${resp.status}`);

  const json = await resp.json();
  return json.access_token;
}

async function fetchAllAlbums(artistId: string, headers: any) {
  let albums: any[] = [];
  let nextUrl = `https://api.spotify.com/v1/artists/${artistId}/albums?include_groups=album,single&market=BR&limit=50`;

  while (nextUrl) {
    const resp = await fetch(nextUrl, { headers });
    if (!resp.ok) throw new Error(`Erro ao buscar álbuns: ${resp.status}`);
    const json = await resp.json();

    if (Array.isArray(json.items)) {
      albums.push(...json.items);
    }

    nextUrl = json.next;
  }

  return albums;
}

async function fetchTracksByAlbum(albumId: string, headers: any) {
  const resp = await fetch(`https://api.spotify.com/v1/albums/${albumId}/tracks`, { headers });
  if (!resp.ok) throw new Error(`Erro ao buscar tracks do álbum ${albumId}: ${resp.status}`);
  const json = await resp.json();
  return json.items || [];
}

async function fetchTracksDetailsBatch(trackIds: string[], headers: any) {
  const chunks: string[][] = [];
  for (let i = 0; i < trackIds.length; i += 50) {
    chunks.push(trackIds.slice(i, i + 50));
  }

  const detailedTracks: any[] = [];
  for (const chunk of chunks) {
    const resp = await fetch(`https://api.spotify.com/v1/tracks?ids=${chunk.join(',')}`, { headers });
    if (!resp.ok) throw new Error(`Erro ao buscar detalhes das faixas: ${resp.status}`);
    const json = await resp.json();
    detailedTracks.push(...(json.tracks || []));
  }
  return detailedTracks;
}

async function fetchSpotifyFull(artistId: string) {
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}` };

  // Buscar artista
  const artistResp = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, { headers });
  if (!artistResp.ok) throw new Error(`Erro ao buscar artista: ${artistResp.status}`);
  const artist = await artistResp.json();

  // Buscar todos os álbuns (paginação)
  const albums = await fetchAllAlbums(artistId, headers);

  // Buscar faixas explícitas para cada álbum
  const albumsWithTracks = await Promise.all(
    albums.map(async (album) => {
      const tracks = await fetchTracksByAlbum(album.id, headers);
      return { ...album, tracks };
    })
  );

  // Pegar todos os IDs das faixas para buscar detalhes em lote
  const allTrackIds = albumsWithTracks.flatMap(album => album.tracks.map((t: any) => t.id));

  // Buscar detalhes completos das faixas
  const detailedTracks = await fetchTracksDetailsBatch(allTrackIds, headers);

  // Criar mapa para fácil lookup das faixas detalhadas
  const detailedTracksMap = new Map<string, any>();
  detailedTracks.forEach(track => detailedTracksMap.set(track.id, track));

  // Substituir faixas básicas pelas detalhadas nos álbuns
  const albumsWithDetailedTracks = albumsWithTracks.map(album => ({
    ...album,
    tracks: album.tracks.map((t: any) => detailedTracksMap.get(t.id) || t),
  }));

  return { artist, albums: albumsWithDetailedTracks, tracks: detailedTracks };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-cache-secret');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const providedSecret = (req.headers['x-cache-secret'] as string) || (req.query?.secret as string);
  if (process.env.CRON_SECRET && providedSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized: segredo inválido' });
  }

  const ARTIST_ID = process.env.ARTIST_ID;
  if (!ARTIST_ID) return res.status(500).json({ error: 'ARTIST_ID não configurado' });

  try {
    const now = Date.now();

    const globalCache = globalThis.__spotifyCache__;

    // Parâmetro para ignorar cache
    const ignoreCache = req.query.nocache === 'true';

    if (!ignoreCache && globalCache && now - globalCache.lastUpdated < CACHE_TTL_MS) {
      return res.status(200).json({ lastUpdated: globalCache.lastUpdated, data: globalCache.data, fromCache: true });
    }

    // Busca dados frescos e atualiza cache
    const data = await fetchSpotifyFull(ARTIST_ID);

    globalThis.__spotifyCache__ = { data, lastUpdated: now };

    return res.status(200).json({ lastUpdated: now, data, fromCache: false });
  } catch (err: any) {
    console.error('Erro em cache-artist-tracks:', err);
    return res.status(500).json({ error: 'Erro ao buscar dados do Spotify', details: err?.message || err });
  }
}
