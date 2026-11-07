import { createFileRoute } from "@tanstack/react-router";
import { RouteError } from "@/components/route-error";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getEditorialBoard } from "@/lib/identity.functions";
import { PageTitle } from "@/lib/ui";

const q = queryOptions({ queryKey: ["editorial-board"], queryFn: () => getEditorialBoard() });
const ROLE_LABEL: Record<string, string> = {
  EDITOR_IN_CHIEF: "Editor-in-Chief", ASSOCIATE_EDITOR: "Associate Editor", EDITORIAL_BOARD_MEMBER: "Editorial Board Member", ADVISORY_BOARD_MEMBER: "Advisory Board Member",
};
const ORDER = ["EDITOR_IN_CHIEF", "ASSOCIATE_EDITOR", "EDITORIAL_BOARD_MEMBER", "ADVISORY_BOARD_MEMBER"];

export const Route = createFileRoute("/editorial-board")({
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  head: () => ({ meta: [{ title: "Editorial board | Paperly" }, { property: "og:title", content: "Editorial board | Paperly" }, { property: "og:description", content: "People who have confirmed their role in Paperly's editorial work." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "description", content: "People who have confirmed their role in Paperly's editorial work." }] }),
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} compact />,
  component: Board,
});

function Board() {
  const { data } = useSuspenseQuery(q);
  return (
    <div className="mx-auto max-w-4xl px-5 pt-10">
      <PageTitle title="Editorial board" subtitle="Only people who have confirmed their participation are listed." />
      {data.length === 0 && <p className="py-6 text-muted-foreground">No editorial board has been published yet. Paperly does not list anyone until an administrator has confirmed their participation.</p>}
      {ORDER.map((role) => {
        const people = data.filter((m) => m.role === role);
        if (!people.length) return null;
        return (
          <section key={role} className="mt-10" aria-labelledby={`h-${role}`}>
            <h2 id={`h-${role}`} className="border-b border-border pb-2 text-[1.25rem]">{ROLE_LABEL[role]}{people.length > 1 ? "s" : ""}</h2>
            <ul className="divide-y divide-border">
              {people.map((m) => (
                <li key={m.id} className="py-5">
                  <p className="font-serif text-[1.125rem] font-semibold">{m.full_name}{m.credentials ? <span className="font-sans text-[15px] font-normal text-muted-foreground">, {m.credentials}</span> : null}</p>
                  <p className="text-[15px]">{m.affiliation}{m.country ? `, ${m.country}` : ""}</p>
                  {m.orcid && <p className="text-sm"><a className="link" href={`https://orcid.org/${m.orcid}`} rel="noopener">ORCID {m.orcid}</a></p>}
                  {m.biography && <p className="mt-2 max-w-[70ch] text-[15px] text-muted-foreground">{m.biography}</p>}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
