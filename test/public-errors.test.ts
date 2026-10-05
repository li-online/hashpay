import { describe, expect, it } from "vitest";
import { AppError } from "@/server/http/api";
import { publicCheckoutErrorBody } from "@/server/http/public-errors";

describe("public checkout errors", () => {
  it("keeps user-correctable checkout errors visible", () => {
    expect(publicCheckoutErrorBody(new AppError(400, "errors.review_image_invalid"))).toEqual({
      body: { error: { key: "errors.review_image_invalid", params: {} } },
      status: 400,
    });
  });

  it("hides payment infrastructure errors from checkout users", () => {
    expect(publicCheckoutErrorBody(new AppError(500, "errors.payment_credential_invalid"))).toEqual({
      body: { error: { key: "errors.checkout_unavailable", params: {} } },
      status: 500,
    });
  });

  it("uses pending copy for unmatched payment checks", () => {
    expect(publicCheckoutErrorBody(new AppError(404, "errors.tx_not_found"))).toEqual({
      body: { error: { key: "errors.checkout_payment_pending", params: {} } },
      status: 404,
    });
  });
});
