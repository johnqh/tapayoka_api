import Stripe from "stripe";
import { getEnv } from "../lib/env-helper.ts";

let stripeClient: Stripe | null = null;

/** Get or initialize the Stripe client */
export function getStripe(): Stripe {
  if (!stripeClient) {
    const secretKey = getEnv("STRIPE_SECRET_KEY");
    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    stripeClient = new Stripe(secretKey);
  }
  return stripeClient;
}

/** Create a payment intent for an order */
export async function createPaymentIntent(
  amountCents: number,
  metadata: Record<string, string>
): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();
  return stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    metadata,
  });
}

/** Confirm a payment intent with a payment method */
export async function confirmPayment(
  paymentIntentId: string,
  paymentMethodId: string
): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();
  return stripe.paymentIntents.confirm(paymentIntentId, {
    payment_method: paymentMethodId,
  });
}
