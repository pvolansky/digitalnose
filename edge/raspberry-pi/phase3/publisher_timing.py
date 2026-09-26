"""Opt-in publisher timing only; no transport/payload changes or sensitive logging."""
from datetime import datetime, timezone
import time
import uuid


def timed_sync_once(sync, box, url, credential, now, preserve, emit, sender=None, jitter=None):
    from phase2.publish import upload
    started = time.monotonic()
    fields = dict(attempt_id=str(uuid.uuid4()), sequence_number=None, attempt=None,
                  queue_selection_started_at=None, queue_selected_at=None,
                  preservation_started_at=None, preservation_ended_at=None, preservation_ms=None,
                  http_started_at=None, http_ended_at=None, http_ms=None,
                  acknowledgement_at=None, http_status=None, error_class=None, error_phase=None)

    def stamp():
        return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

    def error(exc, phase):
        # Fixed vocabulary, never arbitrary exception text or class names.
        import sqlite3
        from urllib.error import URLError
        import ssl
        choices = ((TimeoutError, 'TimeoutError'), (ssl.SSLError, 'SSLError'),
                   (URLError, 'URLError'), (sqlite3.Error, 'SQLiteError'),
                   (OSError, 'OSError'), (ValueError, 'ValueError'))
        fields['error_class'] = next((name for cls, name in choices if isinstance(exc, cls)), 'Error')
        fields['error_phase'] = phase

    class ObservedBox:
        def next(self, at):
            fields['queue_selection_started_at'] = stamp()
            row = box.next(at)
            fields['queue_selected_at'] = stamp()
            if row is not None:
                fields.update(sequence_number=row['sequence'], attempt=row['attempts'] + 1)
            return row

        def acknowledge(self, row):
            box.acknowledge(row)
            fields['acknowledgement_at'] = stamp()

        def fail(self, *args):
            return box.fail(*args)

    def preserving(body):
        fields['preservation_started_at'] = stamp()
        begin = time.monotonic()
        try:
            return preserve(body)
        except Exception as exc:
            error(exc, 'preservation')
            raise
        finally:
            fields['preservation_ended_at'] = stamp()
            fields['preservation_ms'] = round((time.monotonic() - begin) * 1000, 3)

    def sending(*args):
        fields['http_started_at'] = stamp()
        begin = time.monotonic()
        try:
            result = (sender or upload)(*args)
            fields['http_status'] = result[0]
            return result
        except Exception as exc:
            error(exc, 'http')
            raise
        finally:
            fields['http_ended_at'] = stamp()
            fields['http_ms'] = round((time.monotonic() - begin) * 1000, 3)

    try:
        kwargs = {'sender': sending, 'preserve': preserving}
        if jitter is not None:
            kwargs['jitter'] = jitter
        result = sync(ObservedBox(), url, credential, now, **kwargs)
        if result is not None:
            fields['http_status'] = result['http_status']
        return result
    except Exception as exc:
        if fields['error_phase'] is None:
            error(exc, 'queue_or_acknowledgement')
        raise
    finally:
        fields['total_loop_ms'] = round((time.monotonic() - started) * 1000, 3)
        if fields['sequence_number'] is not None or fields['error_phase'] is not None:
            try:
                emit(fields)
            except Exception:
                # Logging failure must not cause a second HTTP send or alter acknowledgement.
                pass
