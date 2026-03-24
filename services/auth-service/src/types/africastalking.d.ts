declare module "africastalking" {
  interface SmsPayload {
    to: string[];
    message: string;
    from?: string;
  }

  interface SmsService {
    send(opts: SmsPayload): Promise<unknown>;
  }

  interface AfricasTalkingInstance {
    SMS: SmsService;
  }

  function AfricasTalking(opts: {
    username: string;
    apiKey: string;
  }): AfricasTalkingInstance;

  export = AfricasTalking;
}
