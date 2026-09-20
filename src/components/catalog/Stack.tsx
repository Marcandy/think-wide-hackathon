import type { ReactNode } from "react";

type StackProps = {
	direction: "vertical" | "horizontal";
	children: ReactNode;
};

export function Stack({ direction, children }: StackProps) {
	return (
		<div className={`catalog-stack catalog-stack-${direction}`}>{children}</div>
	);
}
