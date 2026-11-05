import { redirect } from "next/navigation";
import { requireAuth } from "@/server/auth/session";

export default async function Home() {
  await requireAuth();
  redirect("/carriers");
}
