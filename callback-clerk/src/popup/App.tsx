import { useEffect, useState } from "react";
import { getCredentials, type StoredCredentials } from "../lib/storage";
import PairingView from "./PairingView";
import StatusView from "./StatusView";

export default function App() {
  const [credentials, setCredentials] = useState<StoredCredentials | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCredentials().then((creds) => {
      setCredentials(creds);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">Loading...</div>
    );
  }

  if (!credentials) {
    return (
      <PairingView
        onPaired={(creds) => {
          setCredentials(creds);
        }}
      />
    );
  }

  return <StatusView credentials={credentials} onUnpair={() => setCredentials(null)} />;
}
