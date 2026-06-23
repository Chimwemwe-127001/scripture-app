"""
vp_helper.py: the Python side of Scripture Panel Companion, packaged as one
program so the second laptop does not need Python installed.

    vp-helper --bridge   VideoPsalm control (videopsalm_bridge.py's daemon)
    vp-helper --watch    where VideoPsalm is on screen (vp_window_watch.py)
"""
import sys

import videopsalm_bridge
import vp_window_watch

if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    if mode == '--bridge':
        videopsalm_bridge.daemon()
    elif mode == '--watch':
        try:
            vp_window_watch.main()
        except (KeyboardInterrupt, BrokenPipeError):
            pass
    else:
        sys.exit('Usage: vp-helper --bridge | --watch')
