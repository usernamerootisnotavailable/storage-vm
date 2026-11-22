FROM almalinux:10

# Tell systemd it is running inside Docker so it skips host-only setup.
ENV container=docker

# Package versions follow the AlmaLinux 10 base image and receive security updates.
# hadolint ignore=DL3041
RUN dnf -y install \
      dnf-plugins-core \
      gzip \
      iproute \
      openssh-server \
      procps-ng \
      python3 \
      sudo \
      systemd \
      tar \
    && dnf clean all \
    && rm -rf /var/cache/dnf

RUN useradd --create-home --shell /bin/bash ansible \
    && printf 'ansible ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/ansible \
    && chmod 0440 /etc/sudoers.d/ansible \
    && install -d -m 0700 -o ansible -g ansible /home/ansible/.ssh \
    && ssh-keygen -A \
    && systemctl enable sshd

COPY entrypoint.sh /usr/local/sbin/storage-host-entrypoint
RUN chmod 0755 /usr/local/sbin/storage-host-entrypoint

STOPSIGNAL SIGRTMIN+3
EXPOSE 22
ENTRYPOINT ["/usr/local/sbin/storage-host-entrypoint"]
CMD ["/usr/sbin/init"]
