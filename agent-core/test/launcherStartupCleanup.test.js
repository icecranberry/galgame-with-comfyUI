import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('桌面启动器：清理结果控制服务启动，失败可重试并恢复按钮状态', t => {
  const python = process.env.PYTHON || 'python';
  const available = spawnSync(python, ['-c', 'import PySide6, psutil'], { encoding: 'utf8' });
  if (available.error || available.status !== 0) {
    t.skip('需要 launcher/requirements.txt 中的 Python、PySide6 和 psutil');
    return;
  }
  const script = String.raw`
import ast
import sys
import time
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path.cwd() / 'launcher'))
import psutil
from PySide6.QtCore import QCoreApplication
from launcher.service_runner import PortCleaner, ServiceRunner

app = QCoreApplication.instance() or QCoreApplication([])

class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.runner = ServiceRunner(str(Path.cwd()))
        self.runner.vector_worker.start = Mock()
        self.runner.agent_worker.start = Mock()
        self.cleaner = PortCleaner()
        self.completed = []
        self.logs = []
        self.summaries = []
        self.started = []
        self.cleaner.finished.connect(self.completed.append)
        self.cleaner.finished.connect(self.runner._on_ports_cleaned)
        self.cleaner.output.connect(lambda name, text: self.logs.append(text))
        self.runner.status_summary.connect(lambda *args: self.summaries.append(args))
        self.runner.startup_started.connect(lambda: self.started.append(True))
        self.proc = Mock()
        self.proc.name.return_value = 'node.exe'
        self.proc.cmdline.return_value = ['node', 'agent-core/app.js']
        self.conn = SimpleNamespace(laddr=SimpleNamespace(port=3099), status='LISTEN', pid=42)

    def run_cleanup(self, scans, process_error=None):
        with patch('psutil.net_connections', side_effect=scans), patch('psutil.Process', return_value=self.proc, side_effect=process_error) as lookup:
            self.cleaner.run()
        return lookup

    def assert_blocked(self):
        self.assertEqual(self.completed, [False])
        self.runner.vector_worker.start.assert_not_called()
        self.runner.agent_worker.start.assert_not_called()
        self.assertEqual(self.summaries[-1][-1], 'start_failed')
        self.assertIn('已取消启动', '\n'.join(self.logs))
        self.assertEqual(self.started, [], '清理失败不能触发附属服务的联动启动')

    def test_waits_for_exit_before_starting(self):
        self.proc.wait.side_effect = lambda **kwargs: self.runner.vector_worker.start.assert_not_called()
        self.run_cleanup([[self.conn], []])
        self.assertEqual(self.proc.method_calls[-2:], [unittest.mock.call.kill(), unittest.mock.call.wait(timeout=5)])
        self.assertEqual(self.completed, [True])
        self.runner.vector_worker.start.assert_called_once()
        self.assertEqual(self.started, [True])
        self.runner.agent_worker.start.assert_not_called()
        self.runner.vector_worker.health_changed.emit('vector', True)
        self.runner.agent_worker.start.assert_called_once()

    def test_free_ports_start_without_killing(self):
        lookup = self.run_cleanup([[], []])
        lookup.assert_not_called()
        self.assertEqual(self.completed, [True])
        self.runner.vector_worker.start.assert_called_once()

    def test_permission_denied_blocks_and_retry_succeeds(self):
        self.proc.kill.side_effect = psutil.AccessDenied(42)
        self.run_cleanup([[self.conn]])
        self.assert_blocked()
        self.proc.wait.assert_not_called()
        self.proc.kill.side_effect = None
        self.run_cleanup([[self.conn], []])
        self.assertEqual(self.completed, [False, True])
        self.runner.vector_worker.start.assert_called_once()

    def test_exit_timeout_blocks(self):
        self.proc.wait.side_effect = psutil.TimeoutExpired(5, pid=42)
        self.run_cleanup([[self.conn]])
        self.assert_blocked()

    def test_initial_scan_error_blocks(self):
        self.run_cleanup([psutil.AccessDenied()])
        self.assert_blocked()

    def test_verification_scan_error_blocks(self):
        self.run_cleanup([[self.conn], psutil.AccessDenied()])
        self.assert_blocked()

    def test_non_project_listener_is_not_killed_and_blocks_start(self):
        self.proc.cmdline.return_value = ['node', 'unrelated-service.js']
        self.run_cleanup([[self.conn], [self.conn]])
        self.proc.kill.assert_not_called()
        self.assert_blocked()
        self.assertIn('3099', '\n'.join(self.logs))

    def test_disappeared_process_is_success_if_port_is_free(self):
        self.run_cleanup([[self.conn], []], psutil.NoSuchProcess(42))
        self.assertEqual(self.completed, [True])

    def test_unknown_pid_is_not_treated_as_current_process(self):
        self.conn.pid = None
        lookup = self.run_cleanup([[self.conn]])
        lookup.assert_not_called()
        self.assert_blocked()

    def test_background_failure_finishes_thread_and_restores_buttons(self):
        # 执行实际窗口状态处理函数，不创建窗口，也不复制其业务逻辑。
        source = ast.parse(Path('launcher/launcher/app.py').read_text(encoding='utf-8'))
        cls = next(node for node in source.body if isinstance(node, ast.ClassDef) and node.name == 'MainWindow')
        method = next(node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == '_on_service_status')
        namespace = {}
        exec(compile(ast.Module(body=[method], type_ignores=[]), '<actual window handler>', 'exec'), namespace)
        window = SimpleNamespace(_runner=self.runner, _home_page=Mock(), _log_page=Mock(), _config={})
        self.runner.status_summary.connect(lambda *args: namespace['_on_service_status'](window, *args))
        with patch('psutil.net_connections', side_effect=psutil.AccessDenied()):
            self.runner.start_all()
            deadline = time.monotonic() + 3
            try:
                while time.monotonic() < deadline:
                    app.processEvents()
                    if self.summaries and not self.runner._cleaner_thread.isRunning():
                        break
                    time.sleep(0.005)
                self.assertFalse(self.runner._cleaner_thread.isRunning())
                self.assertEqual(self.summaries[-1][-1], 'start_failed')
                self.runner.vector_worker.start.assert_not_called()
                self.runner.agent_worker.start.assert_not_called()
                window._home_page.set_launch_state.assert_called_with(False)
                window._log_page.set_busy_state.assert_called_with(False)
            finally:
                self.runner._cleaner_thread.quit()
                self.runner._cleaner_thread.wait(3000)

    def test_start_request_does_not_schedule_addons_before_cleanup(self):
        source = ast.parse(Path('launcher/launcher/app.py').read_text(encoding='utf-8'))
        cls = next(node for node in source.body if isinstance(node, ast.ClassDef) and node.name == 'MainWindow')
        method = next(node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == '_start_services')
        timer = Mock()
        namespace = {'QTimer': timer}
        exec(compile(ast.Module(body=[method], type_ignores=[]), '<actual start handler>', 'exec'), namespace)
        window = SimpleNamespace(_runner=Mock(), _home_page=Mock(), _log_page=Mock(), _config={}, _maybe_start_maibot_with_core=Mock())
        namespace['_start_services'](window)
        window._runner.start_all.assert_called_once()
        timer.singleShot.assert_not_called()

    def test_vector_failure_after_success_does_not_restart_core(self):
        self.run_cleanup([[], []])
        self.runner.vector_worker.health_changed.emit('vector', True)
        self.runner.vector_worker.status_changed.emit('vector', 'error')
        self.runner.agent_worker.start.assert_called_once()

    def test_vector_timeout_then_recovery_starts_core_only_once(self):
        self.run_cleanup([[], []])
        self.runner.vector_worker.status_changed.emit('vector', 'timeout')
        self.runner.vector_worker.health_changed.emit('vector', True)
        self.runner.agent_worker.start.assert_called_once()

    def test_synchronous_vector_launch_failure_still_starts_core(self):
        self.runner.vector_worker.start.side_effect = lambda: self.runner.vector_worker.status_changed.emit('vector', 'error')
        self.run_cleanup([[], []])
        self.runner.agent_worker.start.assert_called_once()

    def test_stop_cancels_pending_vector_callbacks(self):
        self.run_cleanup([[], []])
        self.runner.vector_worker.stop = Mock()
        self.runner.agent_worker.stop = Mock()
        self.runner.stop_all()
        self.runner.vector_worker.health_changed.emit('vector', True)
        self.runner.vector_worker.status_changed.emit('vector', 'error')
        self.runner.agent_worker.start.assert_not_called()
        self.runner._stop_timer.stop()

    def test_closing_during_cleanup_waits_for_thread_and_never_starts_services(self):
        entered = threading.Event()
        release = threading.Event()
        def scan(**kwargs):
            entered.set()
            if not release.wait(3):
                raise RuntimeError('test timed out')
            return []
        self.runner.vector_worker.stop = Mock()
        self.runner.agent_worker.stop = Mock()
        with patch('psutil.net_connections', side_effect=scan):
            self.runner.start_all()
            try:
                self.assertTrue(entered.wait(1))
                self.assertTrue(self.runner.any_active(), '清理线程必须计入关闭窗口时的等待条件')
                self.runner.stop_all()
                release.set()
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    app.processEvents()
                    if self.summaries and not self.runner._cleaner_thread.isRunning():
                        break
                    time.sleep(0.005)
                self.assertFalse(self.runner.any_active())
                self.assertEqual(self.summaries[-1][-1], 'all_stopped')
                self.runner.vector_worker.start.assert_not_called()
                self.runner.agent_worker.start.assert_not_called()
                self.assertEqual(self.started, [])
            finally:
                release.set()
                self.runner._cleaner_thread.quit()
                self.runner._cleaner_thread.wait(3000)
                self.runner._stop_timer.stop()

unittest.main(verbosity=2)
`;
  const result = spawnSync(python, ['-B', '-X', 'utf8', '-c', script], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    encoding: 'utf8', timeout: 20000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 16 tests/);
});
