import api from './api';
import { Result, runCatching } from './result';
import { WenkuNovelOutlineDto } from './api_wenku_novel';
import { WebNovelOutlineDto } from './api_web_novel';
import { Page } from './page';

async function listReadHistoryWebNovel(
  page: number,
  pageSize: number,
  token: string
): Promise<Result<Page<WebNovelOutlineDto>>> {
  return runCatching(
    api
      .get(`user/read-history-web/list`, {
        headers: { Authorization: 'Bearer ' + token },
        searchParams: { page, pageSize },
      })
      .json()
  );
}

async function putReadHistoryWebNovel(
  providerId: string,
  novelId: string,
  chapterId: string,
  token: string
) {
  return runCatching(
    api
      .put(`user/read-history-web/${providerId}/${novelId}`, {
        headers: { Authorization: 'Bearer ' + token },
        body: chapterId,
      })
      .json()
  );
}

async function listFavoritedWebNovel(
  page: number,
  pageSize: number,
  sort: 'create' | 'update',
  token: string
): Promise<Result<Page<WebNovelOutlineDto>>> {
  return runCatching(
    api
      .get(`user/favorited-web/list`, {
        headers: { Authorization: 'Bearer ' + token },
        searchParams: { page, pageSize, sort },
      })
      .json()
  );
}

async function putFavoritedWebNovel(
  providerId: string,
  novelId: string,
  token: string
) {
  return runCatching(
    api
      .put(`user/favorited-web/${providerId}/${novelId}`, {
        headers: { Authorization: 'Bearer ' + token },
      })
      .json()
  );
}

async function deleteFavoritedWebNovel(
  providerId: string,
  novelId: string,
  token: string
) {
  return runCatching(
    api
      .delete(`user/favorited-web/${providerId}/${novelId}`, {
        headers: { Authorization: 'Bearer ' + token },
      })
      .json()
  );
}

async function listFavoritedWenkuNovel(
  page: number,
  pageSize: number,
  sort: 'create' | 'update',
  token: string
): Promise<Result<Page<WenkuNovelOutlineDto>>> {
  return runCatching(
    api
      .get(`user/favorited-wenku/list`, {
        headers: { Authorization: 'Bearer ' + token },
        searchParams: { page, pageSize, sort },
      })
      .json()
  );
}

async function putFavoritedWenkuNovel(novelId: string, token: string) {
  return runCatching(
    api
      .put(`user/favorited-wenku/${novelId}`, {
        headers: { Authorization: 'Bearer ' + token },
      })
      .json()
  );
}

async function deleteFavoritedWenkuNovel(novelId: string, token: string) {
  return runCatching(
    api
      .delete(`user/favorited-wenku/${novelId}`, {
        headers: { Authorization: 'Bearer ' + token },
      })
      .json()
  );
}

export const ApiUser = {
  listReadHistoryWebNovel,
  putReadHistoryWebNovel,
  //
  listFavoritedWebNovel,
  putFavoritedWebNovel,
  deleteFavoritedWebNovel,
  //
  listFavoritedWenkuNovel,
  putFavoritedWenkuNovel,
  deleteFavoritedWenkuNovel,
};