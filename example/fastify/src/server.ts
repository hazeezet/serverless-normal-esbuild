'use strict'
import awsLambdaFastify from '@fastify/aws-lambda';

// Require the framework
import Fastify from 'fastify';

// Register your application as a normal plugin.
import appService from './app';

// Require library to exit fastify process, gracefully (if possible)
import closeWithGrace, {CloseWithGraceAsyncCallback} from 'close-with-grace';

interface log {
	transport: {
		target: string,
	}
}

function init()
{
	let log: boolean | log = false;

	if(process.env.NODE_ENV != "production"){
		log = {
			transport: {
				target: 'pino-pretty',
			}
		}
	}

	// Instantiate Fastify with some config
	const app = Fastify({
		logger: log
	})


	app.register(appService);

	// delay is the number of milliseconds for the graceful close to finish
	const closeListenersCallback: CloseWithGraceAsyncCallback = async ({ err }) => {
		if (err) {
			app.log.error(err)
		}
		await app.close()
	};

	const closeListeners = closeWithGrace(
		{ delay: 500 },
		closeListenersCallback
	);

	app.addHook('onClose', (instance, done) => {
		closeListeners.uninstall()
		done()
	})

	return app;
}

if (require.main === module)
{
	// called directly i.e. "node app"
	const port: any = process.env.PORT || 5000;
	// Start listening.
	init().listen({ port }, (err) => {
		if (err) {
			init().log.error(err)
			process.exit(1)
		}
	});
}

const proxy = awsLambdaFastify(init(),{
	callbackWaitsForEmptyEventLoop: false
});

exports.handler = async (event: unknown, content: any) => proxy(event, content);
