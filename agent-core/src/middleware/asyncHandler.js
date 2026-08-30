// 统一 async 路由错误兜底。
//
// 背景：Express 4 不会捕获 async 处理器的 promise rejection——未 try/catch 的
// async 路由一旦抛错，请求会永久挂起（rejection 落到进程级
// unhandledRejection，只打日志不响应）。此前项目完全依赖每个路由手写
// try/catch，没有机制保障。
//
// 用法：
//   - 挂载前对整棵路由表调 wrapRouterAsync(router)，自动包装所有 async 处理器；
//   - 新写的散装 async 处理器可用 asyncHandler(fn) 手动包装。

function wrapAsyncHandler(fn) {
  const wrapped = function wrappedHandler(req, res, next) {
    Promise.resolve(fn.call(this, req, res, next)).catch(next);
  };
  Object.defineProperty(wrapped, 'name', { value: fn.name || 'wrappedHandler' });
  return wrapped;
}

/** 手动包装单个 async 处理器，rejection 转交 next(err)。 */
export function asyncHandler(fn) {
  return wrapAsyncHandler(fn);
}

/**
 * 深度遍历路由表，把所有 async 处理器包上 rejection 兜底。
 * 只包装 (req,res,next) 形态的处理器，跳过错误中间件（4 参）与嵌套路由自身。
 * 就地修改并返回 router，需在所有路由注册完成之后、挂载之前调用。
 */
export function wrapRouterAsync(router) {
  const wrapStack = (stack) => {
    for (const layer of stack) {
      if (layer.route?.stack) {
        wrapStack(layer.route.stack);
        continue;
      }
      const handle = layer.handle;
      if (handle?.stack) {
        wrapStack(handle.stack);
        continue;
      }
      if (
        typeof handle === 'function' &&
        handle.length <= 3 &&
        handle.constructor?.name === 'AsyncFunction'
      ) {
        layer.handle = wrapAsyncHandler(handle);
      }
    }
  };
  wrapStack(router.stack);
  return router;
}
