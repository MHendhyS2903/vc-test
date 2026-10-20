import AccountCall from "@/components/AccountCall";

export default function Page({ searchParams }: { searchParams: { as?: string } }) {
  return <AccountCall as={searchParams.as} />;
}
