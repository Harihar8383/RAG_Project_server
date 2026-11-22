import { UTApi } from "uploadthing/server";

/** UploadThing file storage adapter. The token comes from UPLOADTHING_TOKEN. */
export function createUploadThingFileStore() {
  const api = new UTApi();
  return {
    async deleteFile(key) {
      const result = await api.deleteFiles(key);
      if (result && result.success === false) throw new Error("The file could not be deleted from storage.");
    },
  };
}
