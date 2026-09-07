import WalletConnectClient from "../../../components/WalletConnectClient";

type Props = {
  searchParams: Promise<{ token?: string | string[] }>;
};

export default async function WalletConnectPage({ searchParams }: Props) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  return <WalletConnectClient token={token} />;
}
