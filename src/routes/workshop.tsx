import { createFileRoute } from "@tanstack/react-router";
import { Workshop } from "#/components/workshop/Workshop";

export const Route = createFileRoute("/workshop")({
	component: Workshop,
	head: () => ({ meta: [{ title: "Think-wide — Component workshop" }] }),
});
