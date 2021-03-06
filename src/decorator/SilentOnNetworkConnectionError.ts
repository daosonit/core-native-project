import {NetworkConnectionException} from "../Exception";
import {createActionHandlerDecorator} from "./index";
import {app} from "../app";

/**
 * Do nothing (only create a warning log) if NetworkConnectionException is thrown.
 * Mainly used for background tasks.
 */
export function SilentOnNetworkConnectionError() {
    return createActionHandlerDecorator(function* (handler) {
        try {
            yield* handler();
        } catch (e) {
            if (e instanceof NetworkConnectionException) {
                app.logger.exception(
                    e,
                    {
                        actionPayload: handler.maskedParams,
                        isSilent: "true",
                    },
                    handler.actionName
                );
            } else {
                throw e;
            }
        }
    });
}
