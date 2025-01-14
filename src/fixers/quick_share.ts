import {IMutationAware, INetworkAware, IStateAware} from "./base";
import {SettingsObject} from "../settings";
import {FLUser, GameState, GameStateController, StoryletPhases, UnknownStorylet} from "../game_state";
import {getSingletonByClassName} from "../utils";
import {FLApiClient} from "../api_client";
import {FLApiInterceptor} from "../api_interceptor";

const SHARE_BUTTON_SELECTOR =
    "div[class='storylet-root__frequency'] button[class='buttonlet-container'] span[class*='buttonlet-edit']";
const SOURCE_EXTRACTION_REGEX = /\/\/images\.fallenlondon\.com\/icons\/([a-z0-9]+)\.png/;

export class QuickShareFixer implements IMutationAware, IStateAware, INetworkAware {
    private replaceShareButton = false;
    private currentStoryletId: number | null = null;
    private authToken: string | null = null;
    private shareClickListener: EventListener;

    private apiClient: FLApiClient;
    private currentStoryletName: string = "<unknown>";

    constructor() {
        this.apiClient = new FLApiClient();

        this.shareClickListener = (ev) => {
            if (!this.currentStoryletId) {
                return;
            }

            const image = document.querySelector("img[class*='storylet-root__card-image']") as HTMLImageElement;
            const title = document.querySelector("h1[class*='storylet-root__heading']");
            // For some reason event target here is the button itself, not the buttonlet container
            const icon = ev.target as HTMLElement;

            let imageCode = "";

            if (image) {
                const parts = image.src.match(SOURCE_EXTRACTION_REGEX);
                if (parts) {
                    imageCode = parts[1];
                }
            }

            icon?.parentElement?.classList.remove("buttonlet-enabled");
            icon?.classList.remove("fa-pencil");
            icon?.classList.add("fa-refresh", "fa-spin");

            this.apiClient
                .shareToProfile(this.currentStoryletId, this.currentStoryletName, imageCode)
                .then((_r) => {
                    // FIXME: Replace direct CSS manipulation with something classier
                    icon?.classList.remove("fa-refresh", "fa-spin");
                    icon?.classList.add("fa-check");

                    icon?.parentElement?.classList.add("buttonlet-enabled");
                })
                .catch((err) => {
                    console.error(err);
                    icon?.parentElement?.classList.add("buttonlet-enabled");

                    // Make buttonlet to indicate that there was an error
                    if (icon?.parentElement) {
                        icon.parentElement.style.color = "red";
                    }
                });
        };
    }

    applySettings(settings: SettingsObject): void {
        this.replaceShareButton = settings.quick_share_button as boolean;
    }

    checkEligibility(node: HTMLElement): boolean {
        if (!this.replaceShareButton) {
            return false;
        }

        if (this.currentStoryletId == null || this.authToken == null) {
            return false;
        }

        return getSingletonByClassName(node, "media--root") !== null;
    }

    onNodeAdded(node: HTMLElement): void {
        const shareButton = node.querySelector(SHARE_BUTTON_SELECTOR);
        const shareContainer = shareButton?.parentElement;
        if (shareContainer != null && shareContainer.parentElement != null) {
            const shareMimic = shareContainer.cloneNode(true) as HTMLElement;

            shareMimic.addEventListener("click", this.shareClickListener);
            shareContainer.parentElement.replaceChild(shareMimic, shareContainer);
        }
    }

    onNodeRemoved(_node: HTMLElement): void {
        // Do nothing if DOM node is removed.
    }

    linkState(stateController: GameStateController): void {
        stateController.onUserDataLoaded((g) => {
            if (g.user instanceof FLUser) {
                this.authToken = g.user.jwtToken;
            }
        });

        stateController.onStoryletChanged((g: GameState) => {
            if (g.currentStorylet instanceof UnknownStorylet) {
                this.currentStoryletId = null;
                this.currentStoryletName = "<unknown>";
            } else {
                this.currentStoryletId = g.currentStorylet.id;
                this.currentStoryletName = g.currentStorylet.name;
            }
        });
    }

    linkNetworkTools(interceptor: FLApiInterceptor): void {
        // FIXME: This is a quick hack to work over the fact that our state controller does not
        // expose hooks for branch results. This should be removed when appropriate hook points are added.

        interceptor.onResponseReceived("/api/storylet/choosebranch", (_request, response) => {
            if ("endStorylet" in response) {
                this.currentStoryletId = response.endStorylet.event.id;
                this.currentStoryletName = response.endStorylet.event.name;
            }
        });
    }
}
