import { config } from "./config.js";
import { metrics } from "./metrics.js";

export async function sendSms(to: string, body: string): Promise<{ success: boolean; sid?: string; error?: string }> {
  if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioPhoneNumber) {
    return { success: false, error: "Twilio not configured" };
  }

  // Normalize phone number — ensure it starts with +
  const phone = to.startsWith("+") ? to : `+${to}`;

  console.log(`[SMS] Sending to ${phone}: "${body.substring(0, 80)}..."`);

  try {
    const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64");
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: phone,
          From: config.twilioPhoneNumber,
          Body: body,
        }).toString(),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error(`[SMS] Failed:`, data.message || data);
      metrics.trackSms(false);
      return { success: false, error: data.message || "SMS send failed" };
    }

    console.log(`[SMS] Sent successfully (SID: ${data.sid})`);
    metrics.trackSms(true);
    return { success: true, sid: data.sid };
  } catch (err) {
    console.error(`[SMS] Error:`, err);
    metrics.trackSms(false);
    return { success: false, error: (err as Error).message };
  }
}
