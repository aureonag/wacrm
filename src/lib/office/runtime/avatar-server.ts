import { OfficeConfigurationError, type OfficeContext } from "@/lib/office/access";
import { getOfficeAssets } from "./asset-server";
import { createOfficeAvatarComposer, type OfficeAvatarComposer } from "./avatar-composition";
import { getOfficeGatewayClient, getOfficeTransport } from "./transport";

let composer: OfficeAvatarComposer | undefined;

/** Called after membership. The gateway receives the current identity per request. */
export function getOfficeAvatarComposer(identity?: OfficeContext): OfficeAvatarComposer {
  if (getOfficeTransport() === "gateway") {
    if (!identity) throw new OfficeConfigurationError();
    const client = getOfficeGatewayClient();
    return { load: (kind, recipe) => client.avatar(identity, kind, recipe) };
  }
  if (!composer) {
    composer = createOfficeAvatarComposer({
      loadLibrary: async () => {
        const asset = await getOfficeAssets().load("assets/gather/avatar/native-library-manifest.json");
        return JSON.parse(asset.bytes.toString("utf8"));
      },
    });
  }
  return composer;
}
