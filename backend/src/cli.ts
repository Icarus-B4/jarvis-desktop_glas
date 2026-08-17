import { startJarvisService } from "./service";

const service = startJarvisService();
console.info(`Jarvis local service listening at ${service.baseUrl}`);

