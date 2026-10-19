export async function workspaceStore<T>(value?: T): Promise<T | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("sunburst-studio", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("workspace");
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction("workspace", value === undefined ? "readonly" : "readwrite");
      const req = value === undefined ? tx.objectStore("workspace").get("current") : tx.objectStore("workspace").put(value, "current");
      tx.oncomplete = () => resolve(value === undefined ? req.result : value); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
