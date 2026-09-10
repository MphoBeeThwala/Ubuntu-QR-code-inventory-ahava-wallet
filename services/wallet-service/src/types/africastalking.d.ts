declare module "africastalking" {
  interface SmsSendOptions {
    to: string[];
    message: string;
    from?: string;
  }

  interface SmsClient {
    send(opts: SmsSendOptions): Promise<unknown>;
  }

  interface AfricasTalkingClient {
    SMS: SmsClient;
  }

  interface AfricasTalkingConfig {
    username: string;
    apiKey: string;
  }

  function AfricasTalking(config: AfricasTalkingConfig): AfricasTalkingClient;

  export = AfricasTalking;
}
