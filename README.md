# 🕊 serverless-normal-esbuild

Build and package your app using normal configuration of typescript and esbuild. . . . just the way you will normally bundle your app without serverless 😊.

It depends on [`etsc node`](https://github.com/a7ul/esbuild-node-tsc) and [`ts-node`](https://github.com/TypeStrong/ts-node)

```bash
npm i serverless-normal-esbuild -D
```

## Example

- [`fastify`](https://github.com/hazeezet/serverless-normal-esbuild/tree/main/example/fastify) 

## Features

- Flexibility: Whatever you can do with typescript config and esbuild config you can do it here too
- No need to install any additional plugins
- Supports `sls package`, `sls deploy`
- Integrates with [`offline`](https://github.com/dherault/serverless-offline)

---

### why this when there are many packages

Sometimes I will like to bundle my app the way I want it, each ts file should be separated without compressing them into single file because my project require it.

**`for example:`**

```js
fastify.register(AutoLoad, {
	dir: join(__dirname, 'routes'),
	options: Object.assign({}, opts)
});
```
> this code need to read from a directory `routes` ( written in typescript ) and at the same time it should be compiled and deployed.

this work fine when bundling with normal esbuild and typescript but not with any serverless bundling packages.

***That is the reason for the birth of this package.***

---

```yml
plugins:
    - serverless-normal-esbuild
    ...
```

`node_modules` is included as external by default, if you are using `google provider` which require no `node_modules` then you can ignore it.

```yml
custom:
  normal-esbuild:
	node_modules: false
```

Anything else you want to do, do it with [`tsconfig.json`](https://www.typescriptlang.org/tsconfig) and [`etsc.config.js`](https://github.com/a7ul/esbuild-node-tsc/blob/main/README.md#optional-configuration)

