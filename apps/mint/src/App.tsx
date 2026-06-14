import { DynamicWidget } from '@dynamic-labs/sdk-react-core';
import MintButton from './MintButton';

const CREST_URL =
  'https://aggregator.walrus-mainnet.walrus.space/v1/blobs/9uCKVZktCJPMjm6vyZS1ayPSTh9B5yLU5dSs-2AFLdw';

export default function App() {
  return (
    <main className="app">
      <section className="card">
        <img className="crest" src={CREST_URL} alt="ClanWorld crest" />
        <h1>ClanWorld Free Mint</h1>
        <p className="subtitle">Connect a Sui wallet and mint the ClanWorld logo NFT.</p>
        <DynamicWidget />
        <MintButton />
      </section>
    </main>
  );
}
