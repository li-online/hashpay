import { one, run } from "@/server/db";
import type { AppEnv } from "@/server/types/env";

export interface Review {
  answer: string;
  id: number;
  image: string | null;
  imageUrl: string | null;
}

interface ReviewRow {
  answer: string;
  id: number;
  image: ArrayBuffer | null;
  image_url: string | null;
}

export async function saveReview(env: AppEnv, orderId: string, answer: string, image: ArrayBuffer) {
  await run(
    env,
    `
      INSERT INTO review(order_id, answer, image, image_url)
      VALUES(?, ?, ?, NULL)
      ON CONFLICT(order_id) DO UPDATE SET
        answer = excluded.answer,
        image = excluded.image,
        image_url = NULL
    `,
    orderId,
    answer,
    image,
  );
  return (await getReview(env, orderId))!;
}

export async function getReview(env: AppEnv, orderId: string) {
  const row = await one<ReviewRow>(env, "SELECT id, answer, image, image_url FROM review WHERE order_id = ?", orderId);
  return row ? review(row) : null;
}

export async function clearReviewImage(env: AppEnv, orderId: string) {
  await run(env, "UPDATE review SET image = NULL, image_url = NULL WHERE order_id = ?", orderId);
}

export function imageData(input: string) {
  const prefix = "data:image/webp;base64,";
  if (!input.startsWith(prefix)) return null;
  const binary = atob(input.slice(prefix.length));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function review(row: ReviewRow): Review {
  return {
    answer: row.answer,
    id: row.id,
    image: row.image ? dataUrl(row.image) : null,
    imageUrl: row.image_url,
  };
}

function dataUrl(image: ArrayBuffer) {
  const bytes = new Uint8Array(image);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:image/webp;base64,${btoa(binary)}`;
}
