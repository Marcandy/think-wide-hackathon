import { type ReactNode, useId } from "react";

type SectionProps = {
	title: string;
	children: ReactNode;
};

export function Section({ title, children }: SectionProps) {
	const id = useId();

	return (
		<section className="catalog-section" aria-labelledby={id}>
			<h2 id={id}>{title}</h2>
			{children}
		</section>
	);
}
