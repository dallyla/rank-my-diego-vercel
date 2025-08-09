import dotenv from 'dotenv';
dotenv.config();


const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const ARTIST_ID = process.env.ARTIST_ID;

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !ARTIST_ID) {
  console.error('Erro: Variáveis de ambiente SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET ou ARTIST_ID não definidas.');
  process.exit(1);
}

const getAccessToken = async (): Promise<string> => {
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!resp.ok) throw new Error(`Erro ao obter token Spotify: ${resp.status}`);

  const json = await resp.json();
  return json.access_token;
};

const fetchSpotifyFull = async (artistId: string) => {
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
  
  console.log('Resposta dos álbuns:', JSON.stringify(albumsJson, null, 2));
  
  const albumIds = (albumsJson.items ?? []).map((a: any) => a.id);

  // Dividir álbuns em lotes de 20
  const batched: string[][] = [];
  for (let i = 0; i < albumIds.length; i += 20) batched.push(albumIds.slice(i, i + 20));

  const albumsDetailed: any[] = [];
  for (const group of batched) {
    const groupResp = await fetch(`https://api.spotify.com/v1/albums?ids=${group.join(',')}`, { headers });
    if (!groupResp.ok) throw new Error(`Erro ao buscar detalhes de álbuns: ${groupResp.status}`);
    const groupJson = await groupResp.json();
    albumsDetailed.push(...(groupJson.albums || []));
  }

  // Extrair faixas, incluindo imagens do álbum
  const allTracks = albumsDetailed.flatMap((album: any) =>
    album.tracks.items.map((t: any) => ({
      id: t.id,
      name: t.name,
      preview_url: t.preview_url,
      duration_ms: t.duration_ms,
      album: {
        id: album.id,
        name: album.name,
        images: album.images,
        release_date: album.release_date
      },
      artists: t.artists
    }))
  );

  return { artist, albums: albumsJson.items, albumsDetailed, tracks: allTracks };
};

(async () => {
  try {
    const data = await fetchSpotifyFull(ARTIST_ID);
    console.log('Dados do Spotify:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Erro ao buscar dados do Spotify:', err);
  }
})();
