import { queryOptions } from "@tanstack/react-query";
import { getMe, listMyPapers, getMyPaper, listMyCertificates, adminOverview } from "@/lib/app.functions";

// One definition per query, shared by route loaders (prefetch on hover) and components (read from cache).
export const meQuery = () => queryOptions({ queryKey: ["me"], queryFn: () => getMe() });
export const myPapersQuery = () => queryOptions({ queryKey: ["my-papers"], queryFn: () => listMyPapers() });
export const myPaperQuery = (id: string) => queryOptions({ queryKey: ["my-paper", id], queryFn: () => getMyPaper({ data: { id } }) });
export const myCertsQuery = () => queryOptions({ queryKey: ["my-certs"], queryFn: () => listMyCertificates() });
export const adminQuery = () => queryOptions({ queryKey: ["admin"], queryFn: () => adminOverview(), retry: false });
