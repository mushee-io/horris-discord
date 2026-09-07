import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  createWalletChallenge,
  createWalletLinkRequest,
  disconnectWallet,
  getWalletLink,
  verifyWalletChallenge,
  WalletLinkError,
} from "../lib/wallet-link";

const account = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
const otherAccount = privateKeyToAccount("0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd");
const userA = "123456789012345678";
const userB = "223456789012345678";

beforeEach(async () => {
  process.env.WALLET_LINK_SECRET = "horris-wallet-link-test-secret-that-is-long-enough";
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  await disconnectWallet(userA);
  await disconnectWallet(userB);
});

afterEach(async () => {
  await disconnectWallet(userA);
  await disconnectWallet(userB);
  delete process.env.WALLET_LINK_SECRET;
});

describe("Discord wallet ownership linking", () => {
  it("links a signed EVM wallet and makes it available to Discord commands", async () => {
    const token = await createWalletLinkRequest(userA, "discord-interaction-token-a");
    const challenge = await createWalletChallenge({
      token,
      address: account.address,
      chainId: 42220,
      domain: "horris-discord.vercel.app",
    });

    expect(challenge.message).toContain(`Discord User: ${userA}`);
    expect(challenge.message).toContain(`Wallet: ${account.address}`);
    expect(challenge.message).toContain("This signature cannot move funds");

    const signature = await account.signMessage({ message: challenge.message });
    const verified = await verifyWalletChallenge({ token, address: account.address, signature });

    expect(verified.link.discordUserId).toBe(userA);
    expect(verified.link.walletAddress).toBe(account.address);
    expect(verified.link.chainId).toBe(42220);

    const stored = await getWalletLink(userA);
    expect(stored?.walletAddress).toBe(account.address);
  });

  it("rejects a signature from a different wallet", async () => {
    const token = await createWalletLinkRequest(userA, "discord-interaction-token-b");
    const challenge = await createWalletChallenge({ token, address: account.address, chainId: 42220, domain: "horris-discord.vercel.app" });
    const signature = await otherAccount.signMessage({ message: challenge.message });

    await expect(verifyWalletChallenge({ token, address: account.address, signature })).rejects.toMatchObject({
      code: "SIGNATURE_VERIFICATION_FAILED",
      status: 401,
    });
  });

  it("prevents the same wallet from being linked to two Discord accounts", async () => {
    const firstToken = await createWalletLinkRequest(userA, "discord-interaction-token-c");
    const firstChallenge = await createWalletChallenge({ token: firstToken, address: account.address, chainId: 42220, domain: "horris-discord.vercel.app" });
    const firstSignature = await account.signMessage({ message: firstChallenge.message });
    await verifyWalletChallenge({ token: firstToken, address: account.address, signature: firstSignature });

    const secondToken = await createWalletLinkRequest(userB, "discord-interaction-token-d");
    const secondChallenge = await createWalletChallenge({ token: secondToken, address: account.address, chainId: 42220, domain: "horris-discord.vercel.app" });
    const secondSignature = await account.signMessage({ message: secondChallenge.message });

    await expect(verifyWalletChallenge({ token: secondToken, address: account.address, signature: secondSignature })).rejects.toBeInstanceOf(WalletLinkError);
    await expect(verifyWalletChallenge({ token: secondToken, address: account.address, signature: secondSignature })).rejects.toMatchObject({ code: "WALLET_ALREADY_LINKED", status: 409 });
  });

  it("consumes a successful wallet-link request so it cannot be replayed", async () => {
    const token = await createWalletLinkRequest(userA, "discord-interaction-token-e");
    const challenge = await createWalletChallenge({ token, address: account.address, chainId: 42220, domain: "horris-discord.vercel.app" });
    const signature = await account.signMessage({ message: challenge.message });
    await verifyWalletChallenge({ token, address: account.address, signature });

    await expect(verifyWalletChallenge({ token, address: account.address, signature })).rejects.toMatchObject({ code: "REQUEST_EXPIRED", status: 410 });
  });
});
