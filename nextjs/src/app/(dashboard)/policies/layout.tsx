import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Policies & Budgets | FerrumDeck",
  description: "Manage policy rules and budget configurations for agent governance",
};

interface PoliciesLayoutProps {
  children: React.ReactNode;
}

export default function PoliciesLayout({ children }: PoliciesLayoutProps) {
  return children;
}
