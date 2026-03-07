import type { MockupResult } from '../types';

const TOKEN_KEY = 'site_token';

function authHeaders(): HeadersInit {
  const token = localStorage.getItem(TOKEN_KEY);
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchAll(): Promise<MockupResult[]> {
  const res = await fetch('/api/mockups', { headers: authHeaders() });
  if (!res.ok) throw new Error(`fetchAll failed: ${res.status}`);
  return res.json();
}

async function saveResult(result: MockupResult): Promise<void> {
  const res = await fetch('/api/mockups', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(result),
  });
  if (!res.ok) throw new Error(`saveResult failed: ${res.status}`);
}

async function deleteResult(id: string): Promise<void> {
  const res = await fetch(`/api/mockups?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`deleteResult failed: ${res.status}`);
}

export const cloudStorageService = { fetchAll, saveResult, deleteResult };
