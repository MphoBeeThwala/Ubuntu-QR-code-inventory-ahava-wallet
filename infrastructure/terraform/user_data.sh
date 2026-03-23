#!/bin/bash
# infrastructure/terraform/user_data.sh
# EKS optimized AMI bootstrap script for Ahava node groups.
# Rendered by Terraform templatefile() in eks.tf's aws_launch_template.
# Variables:
#   cluster_name — injected by Terraform

set -o xtrace

# Bootstrap the node and join the EKS cluster
/etc/eks/bootstrap.sh "${cluster_name}" \
  --b64-cluster-ca "$(aws eks describe-cluster \
      --name "${cluster_name}" \
      --query "cluster.certificateAuthority.data" \
      --output text)" \
  --apiserver-endpoint "$(aws eks describe-cluster \
      --name "${cluster_name}" \
      --query "cluster.endpoint" \
      --output text)" \
  --kubelet-extra-args "--node-labels=role=services,environment=${cluster_name} \
    --max-pods=110 \
    --kube-reserved=cpu=250m,memory=1Gi,ephemeral-storage=1Gi \
    --system-reserved=cpu=250m,memory=0.2Gi,ephemeral-storage=1Gi \
    --eviction-hard=memory.available<200Mi,nodefs.available<10%"
