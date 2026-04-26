import { callAPI } from './api';

export interface ForumPost {
  id: string;
  authorOpenid: string;
  authorNickname: string | null;
  authorAvatarUrl: string | null;
  title: string;
  content: string;
  replyCount: number;
  lastReplyAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ForumReply {
  id: string;
  postId: string;
  authorOpenid: string;
  authorNickname: string | null;
  authorAvatarUrl: string | null;
  content: string;
  createdAt: string;
}

const PAGE_SIZE = 20;

let cachedPosts: ForumPost[] = [];
let hasMoreFlag = false;
let cacheLoaded = false;

export async function loadPosts(refresh = false): Promise<ForumPost[]> {
  if (refresh || !cacheLoaded) {
    try {
      const res = await callAPI<{ posts: ForumPost[]; hasMore: boolean }>({
        path: `/api/forum/posts?limit=${PAGE_SIZE}`,
        method: 'GET',
      });
      cachedPosts = res.posts || [];
      hasMoreFlag = !!res.hasMore;
      cacheLoaded = true;
    } catch (e) {
      console.error('Failed to load forum posts', e);
      cacheLoaded = true;
    }
  }
  return cachedPosts;
}

export async function loadMore(): Promise<ForumPost[]> {
  if (!hasMoreFlag || cachedPosts.length === 0) return cachedPosts;
  const before = cachedPosts[cachedPosts.length - 1].id;
  try {
    const res = await callAPI<{ posts: ForumPost[]; hasMore: boolean }>({
      path: `/api/forum/posts?limit=${PAGE_SIZE}&before=${before}`,
      method: 'GET',
    });
    cachedPosts = [...cachedPosts, ...(res.posts || [])];
    hasMoreFlag = !!res.hasMore;
  } catch (e) {
    console.error('Failed to load more posts', e);
  }
  return cachedPosts;
}

export function getPosts(): ForumPost[] {
  return cachedPosts;
}

export function hasMore(): boolean {
  return hasMoreFlag;
}

export function isPostsLoaded(): boolean {
  return cacheLoaded;
}

export async function getPostDetail(
  id: string
): Promise<{ post: ForumPost; replies: ForumReply[] } | null> {
  try {
    return await callAPI<{ post: ForumPost; replies: ForumReply[] }>({
      path: `/api/forum/posts/${id}`,
      method: 'GET',
    });
  } catch (e) {
    console.error('Failed to load post detail', e);
    return null;
  }
}

export async function createPost(
  title: string,
  content: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const res = await callAPI<{ success: boolean; id: string }>({
      path: '/api/forum/posts',
      method: 'POST',
      data: { title, content },
    });
    // 创建成功后让下次进入论坛页强制刷新
    cacheLoaded = false;
    return { ok: true, id: res.id };
  } catch (e: any) {
    console.error('Failed to create post', e);
    return { ok: false, error: e?.message || '发帖失败' };
  }
}

export async function deletePost(id: string): Promise<boolean> {
  const backup = cachedPosts;
  cachedPosts = cachedPosts.filter((p) => p.id !== id);
  try {
    await callAPI({
      path: `/api/forum/posts/${id}`,
      method: 'DELETE',
    });
    return true;
  } catch (e) {
    cachedPosts = backup;
    console.error('Failed to delete post', e);
    return false;
  }
}

export async function createReply(
  postId: string,
  content: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const res = await callAPI<{ success: boolean; id: string }>({
      path: `/api/forum/posts/${postId}/replies`,
      method: 'POST',
      data: { content },
    });
    bumpReplyCount(postId, 1);
    return { ok: true, id: res.id };
  } catch (e: any) {
    console.error('Failed to create reply', e);
    return { ok: false, error: e?.message || '回复失败' };
  }
}

export async function deleteReply(replyId: string, postId: string): Promise<boolean> {
  try {
    await callAPI({
      path: `/api/forum/replies/${replyId}`,
      method: 'DELETE',
    });
    bumpReplyCount(postId, -1);
    return true;
  } catch (e) {
    console.error('Failed to delete reply', e);
    return false;
  }
}

function bumpReplyCount(postId: string, delta: number) {
  cachedPosts = cachedPosts.map((p) =>
    p.id === postId ? { ...p, replyCount: Math.max(p.replyCount + delta, 0) } : p
  );
}
