# -*- coding: utf-8 -*-
"""Role-local filters for MariaDB account host derivation."""

from __future__ import absolute_import, division, print_function

__metaclass__ = type

import ipaddress

from ansible.errors import AnsibleFilterError


def mariadb_host_from_cidr(value):
    """Return the MariaDB account host for an application source CIDR.

    IPv4 /32 and IPv6 /128 sources become an exact account host. Broader IPv4
    networks use network/netmask because MariaDB supports IPv4 netmask account
    hosts. Broader IPv6 networks have no MariaDB netmask syntax.
    """
    try:
        cidr = str(value).strip()
        if "/" not in cidr:
            raise ValueError("a CIDR prefix is required")
        network = ipaddress.ip_network(cidr, strict=False)
    except (TypeError, ValueError) as exc:
        raise AnsibleFilterError(
            "Invalid MariaDB application CIDR {0!r}: {1}".format(value, exc)
        )

    if isinstance(network, ipaddress.IPv4Network):
        if network.prefixlen == 32:
            return str(network.network_address)
        return "{0}/{1}".format(network.network_address, network.netmask)

    if network.prefixlen == 128:
        return str(network.network_address)

    raise AnsibleFilterError(
        "MariaDB application CIDR {0!r} is a broader IPv6 network. MariaDB "
        "account netmask syntax is IPv4-only; use an exact IPv6 /128 source "
        "address or an IPv4 CIDR.".format(value)
    )


class FilterModule(object):
    """Expose the MariaDB host derivation filter."""

    def filters(self):
        return {
            "mariadb_host_from_cidr": mariadb_host_from_cidr,
        }
